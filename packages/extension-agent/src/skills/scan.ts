/** @module skills/scan */

import { mkdir, readdir, readFile, stat } from 'fs/promises'
import { load } from 'js-yaml'
import { Context } from 'koishi'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { getSkillsRootPath } from '../config/path'
import { AgentConfig, SkillScope, SkillSource, SkillState } from '../types'
import { collectFilesRecursive } from '../utils/fs'
import { extractFrontmatter } from '../utils/frontmatter'
import { createHashId } from '../utils/id'
import { isPathInside, resolveTildeDir, toPathKey } from '../utils/path'

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
    const targets = await getScanTargets(ctx, cfg)
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
    return await collectFilesRecursive(dir, {
        limit: 200,
        excludeNames: ['SKILL.md'],
        relative: true
    })
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

    if (name.toLowerCase() !== fallbackName.toLowerCase()) {
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

async function getScanTargets(
    ctx: Context,
    cfg: AgentConfig['skills']
): Promise<ScanTarget[]> {
    const root = getSkillsRootPath(ctx)
    const seen = new Set([toPathKey(root)])
    const targets: ScanTarget[] = [
        {
            root,
            source: 'chatluna',
            scope: 'data',
            priority: 0
        }
    ]

    for (let idx = 0; idx < cfg.dirs.length; idx++) {
        const item = cfg.dirs[idx].trim()
        if (!item) {
            continue
        }

        const dir = resolveTildeDir(ctx.baseDir, item)
        const key = toPathKey(dir)
        if (seen.has(key)) {
            continue
        }

        seen.add(key)
        targets.push({
            root: dir,
            source: detectSkillSource(item, dir),
            scope: detectSkillScope(ctx, dir),
            priority: 100 + idx
        })
    }

    return targets
}
function detectSkillSource(raw: string, dir: string): SkillSource {
    const value = `${raw}\n${dir}`.replaceAll('\\', '/').toLowerCase()

    if (value.includes('/.claude/skills') || value.endsWith('/claude/skills')) {
        return 'claude'
    }

    if (value.includes('/.agents/skills') || value.endsWith('/agents/skills')) {
        return 'universal'
    }

    if (value.includes('/.codex/skills') || value.endsWith('/codex/skills')) {
        return 'codex'
    }

    if (
        value.includes('/.opencode/skills') ||
        value.endsWith('/opencode/skills')
    ) {
        return 'opencode'
    }

    return 'custom'
}

function detectSkillScope(ctx: Context, dir: string): SkillScope {
    if (isPathInside(dir, getSkillsRootPath(ctx))) {
        return 'data'
    }

    if (isPathInside(dir, ctx.baseDir)) {
        return 'project'
    }

    if (isPathInside(dir, homedir())) {
        return 'user'
    }

    return 'user'
}
function createSkillId(file: string) {
    return createHashId(file)
}
