import { createHash } from 'crypto'
import { mkdir, readFile, readdir, stat } from 'fs/promises'
import { load } from 'js-yaml'
import { Context } from 'koishi'
import { homedir } from 'os'
import { basename, dirname, join, relative, resolve } from 'path'
import { getSkillsRootPath } from '../config/path'
import { AgentConfig, SkillScope, SkillSource, SkillState } from '../types'

export interface ScannedSkill {
    id: string
    name: string
    description: string
    path: string
    dir: string
    source: SkillSource
    scope: SkillScope
    state: SkillState
    enabled: boolean
    userInvocable: boolean
    implicitInvocation: boolean
    compatibility?: string
    license?: string
    metadata?: Record<string, string>
    allowedTools?: string[]
    diagnostics: string[]
    body: string
    raw: string
    priority: number
}

interface ScanTarget {
    root: string
    source: SkillSource
    scope: SkillScope
    priority: number
}

export async function ensureSkillsRoot(ctx: Context) {
    await mkdir(getSkillsRootPath(ctx), { recursive: true })
}

export async function scanSkills(
    ctx: Context,
    cfg: AgentConfig['skills']
): Promise<ScannedSkill[]> {
    const targets = await getScanTargets(ctx)
    const skills = (
        await Promise.all(targets.map((target) => scanTarget(target, cfg)))
    ).flat()

    return skills.sort((a, b) => {
        if (a.priority !== b.priority) {
            return a.priority - b.priority
        }

        return a.path.localeCompare(b.path)
    })
}

export async function listSkillResources(dir: string): Promise<string[]> {
    const result: string[] = []
    const queue = [dir]

    while (queue.length > 0 && result.length < 200) {
        const current = queue.shift()
        if (!current) {
            continue
        }

        const entries = await readdir(current, { withFileTypes: true }).catch(
            () => []
        )

        for (const entry of entries) {
            if (entry.name === '.git' || entry.name === 'node_modules') {
                continue
            }

            const file = join(current, entry.name)
            const rel = relative(dir, file).replaceAll('\\', '/')

            if (rel === 'SKILL.md') {
                continue
            }

            if (entry.isDirectory()) {
                queue.push(file)
                continue
            }

            if (entry.isFile()) {
                result.push(rel)
                if (result.length >= 200) {
                    break
                }
            }
        }
    }

    return result.sort((a, b) => a.localeCompare(b))
}

async function scanTarget(
    target: ScanTarget,
    cfg: AgentConfig['skills']
): Promise<ScannedSkill[]> {
    const root = await stat(target.root).catch(() => undefined)
    if (!root?.isDirectory()) {
        return []
    }

    const entries = await readdir(target.root, { withFileTypes: true })
    const skills = await Promise.all(
        entries.map(async (entry) => {
            const dir = join(target.root, entry.name)
            const file = join(dir, 'SKILL.md')
            const info = await stat(file).catch(() => undefined)

            if (!info?.isFile()) {
                return undefined
            }

            return parseSkill(file, target, cfg)
        })
    )

    return skills.filter((skill): skill is ScannedSkill => skill != null)
}

async function parseSkill(
    file: string,
    target: ScanTarget,
    cfg: AgentConfig['skills']
): Promise<ScannedSkill> {
    const diagnostics: string[] = []
    const dir = dirname(file)
    const fallbackName = basename(dir)
    const raw = await readFile(file, 'utf-8').catch(() => '')

    if (raw.length < 1) {
        return createInvalidSkill({
            file,
            dir,
            target,
            cfg,
            diagnostics: ['Failed to read SKILL.md or file is empty'],
            raw,
            body: ''
        })
    }

    const parsed = extractFrontmatter(raw)
    if (!parsed) {
        return createInvalidSkill({
            file,
            dir,
            target,
            cfg,
            diagnostics: ['SKILL.md is missing valid YAML frontmatter'],
            raw,
            body: raw.trim()
        })
    }

    let frontmatter: Record<string, unknown>

    try {
        frontmatter =
            (load(parsed.frontmatter) as Record<string, unknown>) ?? {}
    } catch (error) {
        diagnostics.push(
            `Failed to parse frontmatter: ${error instanceof Error ? error.message : String(error)}`
        )

        return createInvalidSkill({
            file,
            dir,
            target,
            cfg,
            diagnostics,
            raw,
            body: parsed.body
        })
    }

    const extra = await readExtraMetadata(dir)
    diagnostics.push(...extra.diagnostics)

    const name =
        typeof frontmatter.name === 'string' && frontmatter.name.length > 0
            ? frontmatter.name
            : fallbackName
    const description =
        typeof frontmatter.description === 'string'
            ? frontmatter.description.trim()
            : ''

    if (name !== fallbackName) {
        diagnostics.push(
            `Frontmatter name '${name}' does not match directory '${fallbackName}'`
        )
    }

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
        diagnostics.push('Skill name should match ^[a-z0-9]+(-[a-z0-9]+)*$')
    }

    if (name.length > 64) {
        diagnostics.push('Skill name is longer than 64 characters')
    }

    if (description.length < 1) {
        diagnostics.push('Skill description is required')
    }

    const metadata = pickMetadata(frontmatter.metadata)
    const allowedTools = parseAllowedTools(frontmatter['allowed-tools'])
    const implicitInvocation =
        frontmatter['disable-model-invocation'] === true
            ? false
            : extra.allowImplicitInvocation !== false
    const userInvocable = frontmatter['user-invocable'] !== false
    const id = createSkillId(file)
    const enabled = cfg.items[id]?.enabled !== false
    const state: SkillState = description.length > 0 ? 'ready' : 'invalid'

    return {
        id,
        name,
        description,
        path: file,
        dir,
        source: target.source,
        scope: target.scope,
        state,
        enabled,
        userInvocable,
        implicitInvocation,
        compatibility:
            typeof frontmatter.compatibility === 'string'
                ? frontmatter.compatibility
                : undefined,
        license:
            typeof frontmatter.license === 'string'
                ? frontmatter.license
                : undefined,
        metadata,
        allowedTools,
        diagnostics,
        body: parsed.body,
        raw,
        priority: target.priority
    }
}

function createInvalidSkill(input: {
    file: string
    dir: string
    target: ScanTarget
    cfg: AgentConfig['skills']
    diagnostics: string[]
    raw: string
    body: string
}): ScannedSkill {
    const id = createSkillId(input.file)

    return {
        id,
        name: basename(input.dir),
        description: '',
        path: input.file,
        dir: input.dir,
        source: input.target.source,
        scope: input.target.scope,
        state: 'invalid',
        enabled: input.cfg.items[id]?.enabled !== false,
        userInvocable: true,
        implicitInvocation: false,
        diagnostics: input.diagnostics,
        body: input.body,
        raw: input.raw,
        priority: input.target.priority
    }
}

async function readExtraMetadata(dir: string): Promise<{
    allowImplicitInvocation?: boolean
    diagnostics: string[]
}> {
    const file = join(dir, 'agents', 'openai.yaml')
    const diagnostics: string[] = []
    const content = await readFile(file, 'utf-8').catch(() => undefined)

    if (!content) {
        return { diagnostics }
    }

    try {
        const extra = (load(content) as Record<string, unknown>) ?? {}
        const policy = extra.policy as Record<string, unknown> | undefined

        return {
            allowImplicitInvocation:
                policy?.allow_implicit_invocation === false ? false : undefined,
            diagnostics
        }
    } catch (error) {
        diagnostics.push(
            `Failed to parse agents/openai.yaml: ${error instanceof Error ? error.message : String(error)}`
        )

        return { diagnostics }
    }
}

function extractFrontmatter(raw: string) {
    const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/)
    if (!match) {
        return undefined
    }

    return {
        frontmatter: match[1],
        body: match[2].trim()
    }
}

function parseAllowedTools(value: unknown) {
    if (typeof value !== 'string' || value.trim().length < 1) {
        return undefined
    }

    const items = value
        .split(/\s*,\s*|\s+/)
        .map((item) => item.trim())
        .filter(Boolean)

    return items.length > 0 ? items : undefined
}

function pickMetadata(value: unknown) {
    if (typeof value !== 'object' || value == null) {
        return undefined
    }

    const result = Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) => {
            if (
                typeof item === 'string' ||
                typeof item === 'number' ||
                typeof item === 'boolean'
            ) {
                return [[key, String(item)]]
            }

            return []
        })
    )

    return Object.keys(result).length > 0 ? result : undefined
}

async function getScanTargets(ctx: Context): Promise<ScanTarget[]> {
    const projectRoots = await getProjectRoots(ctx.baseDir)
    const userHome = homedir()
    const targets: ScanTarget[] = [
        {
            root: getSkillsRootPath(ctx),
            source: 'chatluna',
            scope: 'data',
            priority: 0
        }
    ]

    for (let idx = 0; idx < projectRoots.length; idx++) {
        const root = projectRoots[idx]

        targets.push(
            {
                root: join(root, '.opencode', 'skills'),
                source: 'opencode',
                scope: 'project',
                priority: 100 + idx
            },
            {
                root: join(root, '.claude', 'skills'),
                source: 'claude',
                scope: 'project',
                priority: 200 + idx
            },
            {
                root: join(root, '.agents', 'skills'),
                source: 'codex',
                scope: 'project',
                priority: 300 + idx
            }
        )
    }

    targets.push(
        {
            root: join(userHome, '.config', 'opencode', 'skills'),
            source: 'opencode',
            scope: 'user',
            priority: 400
        },
        {
            root: join(userHome, '.claude', 'skills'),
            source: 'claude',
            scope: 'user',
            priority: 500
        },
        {
            root: join(userHome, '.agents', 'skills'),
            source: 'codex',
            scope: 'user',
            priority: 600
        }
    )

    return targets
}

async function getProjectRoots(baseDir: string) {
    const roots: string[] = []
    let current = resolve(baseDir)

    while (true) {
        roots.push(current)

        if (await hasGitRoot(current)) {
            break
        }

        const parent = resolve(current, '..')
        if (parent === current) {
            break
        }

        current = parent
    }

    return roots
}

async function hasGitRoot(dir: string) {
    const file = join(dir, '.git')
    return (await stat(file).catch(() => undefined)) != null
}

function createSkillId(file: string) {
    return createHash('sha1').update(file).digest('hex').slice(0, 16)
}
