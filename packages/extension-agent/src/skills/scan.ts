/** @module skills/scan */

import { execFile } from 'child_process'
import { mkdir, readdir, readFile, stat } from 'fs/promises'
import { load } from 'js-yaml'
import { Context } from 'koishi'
import { basename, dirname, join } from 'path'
import { promisify } from 'util'
import { DEFAULT_SKILL_DIRS, getSkillsRootPath } from '../config/path'
import { ComputerSessionApi } from '../computer/types'
import {
    AgentConfig,
    SkillInstallAction,
    SkillRequires,
    SkillScope,
    SkillSource,
    SkillState
} from '../types'
import { collectFilesRecursive } from '../utils/fs'
import { extractFrontmatter } from '../utils/frontmatter'
import { createHashId } from '../utils/id'
import { expandDir, isPathInside, toPathKey } from '../utils/path'
import { quoteShellPath } from '../utils/shell'

const execFileAsync = promisify(execFile)
export const REMOTE_SKILLS_ROOT = '~/.chatluna/skills'

export interface ScannedSkill {
    id: string
    name: string
    description: string
    path: string
    dir: string
    remote: boolean
    source: SkillSource
    scope: SkillScope
    state: SkillState
    enabled: boolean
    available: boolean
    userInvocable: boolean
    implicitInvocation: boolean
    emoji?: string
    homepage?: string
    skillKey?: string
    primaryEnv?: string
    compatibility?: string
    license?: string
    metadata?: Record<string, string>
    requires?: SkillRequires
    install?: SkillInstallAction[]
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
    remote: boolean
}

interface OpenClawMetadata {
    always: boolean
    emoji?: string
    homepage?: string
    skillKey?: string
    primaryEnv?: string
    os?: string[]
    requires?: SkillRequires
    install?: SkillInstallAction[]
}

export async function ensureSkillsRoot(ctx: Context) {
    await mkdir(getSkillsRootPath(ctx), { recursive: true })
}

export async function scanSkills(
    ctx: Context,
    cfg: AgentConfig
): Promise<ScannedSkill[]> {
    const targets = await getScanTargets(ctx, cfg.skills)
    const bins = new Map<string, boolean>()

    return (
        await Promise.all(targets.map((t) => scanTarget(ctx, t, cfg, bins)))
    )
        .flat()
        .sort((a, b) =>
            a.priority !== b.priority
                ? a.priority - b.priority
                : a.path.localeCompare(b.path)
        )
}

export async function getSkillRoots(ctx: Context, cfg: AgentConfig['skills']) {
    return (await getScanTargets(ctx, cfg)).map((t) => t.root)
}

export async function scanSkillRoot(
    root: string,
    ctx?: Context
): Promise<ScannedSkill[]> {
    const bins = new Map<string, boolean>()
    const files = await collectFilesRecursive(root)
    const dirs = Array.from(
        new Set(
            files
                .filter((f) => basename(f) === 'SKILL.md')
                .map((f) => dirname(f))
        )
    ).sort((a, b) => a.localeCompare(b))

    return Promise.all(
        dirs.map((dir) =>
            parseSkill(
                join(dir, 'SKILL.md'),
                {
                    root,
                    source: 'custom',
                    scope: 'project',
                    priority: 0,
                    remote: false
                },
                { dirs: [], items: {} },
                undefined,
                bins,
                ctx
            )
        )
    )
}

export async function listSkillResources(dir: string): Promise<string[]> {
    return collectFilesRecursive(dir, {
        limit: 200,
        excludeNames: ['SKILL.md'],
        relative: true
    })
}

export async function listRemoteSkillResources(
    session: ComputerSessionApi,
    dir: string
) {
    const result = await session.execute(
        [
            `root=${quoteShellPath(dir)}`,
            '&& [ -d "$root" ]',
            '&& find "$root" -type f ! -name SKILL.md -print',
            `| awk -v root="$root" 'index($0, root "/") == 1 { print substr($0, length(root) + 2) }'`,
            '|| true'
        ].join(' '),
        {
            timeout: 10000
        }
    )

    if (result.stderr.trim()) {
        throw new Error(result.stderr.trim())
    }

    return result.stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
}

async function scanTarget(
    ctx: Context,
    target: ScanTarget,
    cfg: AgentConfig,
    bins: Map<string, boolean>
): Promise<ScannedSkill[]> {
    const info = await stat(target.root).catch(() => undefined)
    if (!info?.isDirectory()) return []

    const entries = await readdir(target.root, { withFileTypes: true })
    const skills = await Promise.all(
        entries.map(async (entry) => {
            const file = join(target.root, entry.name, 'SKILL.md')
            const fi = await stat(file).catch(() => undefined)
            if (!fi?.isFile()) return undefined
            return parseSkill(file, target, cfg.skills, cfg, bins, ctx)
        })
    )

    return skills.filter((s): s is ScannedSkill => s != null)
}

async function parseSkill(
    file: string,
    target: ScanTarget,
    cfg: AgentConfig['skills'],
    agentCfg?: AgentConfig,
    bins = new Map<string, boolean>(),
    ctx?: Context
): Promise<ScannedSkill> {
    const dir = dirname(file)
    const raw = await readFile(file, 'utf-8').catch(() => '')

    return parseSkillText({
        file,
        dir,
        target,
        cfg,
        agentCfg,
        bins,
        ctx,
        raw,
        extra: await readFile(
            join(dir, 'agents', 'openai.yaml'),
            'utf-8'
        ).catch(() => undefined)
    })
}

async function parseSkillText(input: {
    file: string
    dir: string
    target: ScanTarget
    cfg: AgentConfig['skills']
    agentCfg?: AgentConfig
    bins: Map<string, boolean>
    ctx?: Context
    raw: string
    extra?: string
}): Promise<ScannedSkill> {
    const diagnostics: string[] = []

    if (!input.raw) {
        return createInvalidSkill({
            file: input.file,
            dir: input.dir,
            target: input.target,
            cfg: input.cfg,
            diagnostics: ['Failed to read SKILL.md or file is empty'],
            raw: input.raw,
            body: ''
        })
    }

    const parsed = extractFrontmatter(input.raw)
    if (!parsed) {
        return createInvalidSkill({
            file: input.file,
            dir: input.dir,
            target: input.target,
            cfg: input.cfg,
            diagnostics: ['SKILL.md is missing valid YAML frontmatter'],
            raw: input.raw,
            body: input.raw.trim()
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
            file: input.file,
            dir: input.dir,
            target: input.target,
            cfg: input.cfg,
            diagnostics,
            raw: input.raw,
            body: parsed.body
        })
    }

    const extra = parseExtraMetadata(input.extra)
    diagnostics.push(...extra.diagnostics)
    const openclaw = parseOpenClawMetadata(frontmatter.metadata)

    const name =
        typeof frontmatter.name === 'string' && frontmatter.name
            ? frontmatter.name
            : basename(input.dir)
    const description =
        typeof frontmatter.description === 'string'
            ? frontmatter.description.trim()
            : ''

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
        diagnostics.push('Skill name should match ^[a-z0-9]+(-[a-z0-9]+)*$')
    }

    if (name.length > 64) {
        diagnostics.push('Skill name is longer than 64 characters')
    }

    if (!description) {
        diagnostics.push('Skill description is required')
    }

    const allowedTools = parseAllowedTools(frontmatter['allowed-tools'])
    const availability = await checkAvailability(
        openclaw,
        input.agentCfg,
        input.bins,
        input.ctx
    )
    const id = createHashId(input.file)
    const mode = input.cfg.items[id]?.mode ?? 'description'

    diagnostics.push(...availability.diagnostics)

    return {
        id,
        name,
        description,
        path: input.file,
        dir: input.dir,
        source: input.target.source,
        scope: input.target.scope,
        remote: input.target.remote,
        state: description ? 'ready' : 'invalid',
        enabled: mode !== 'off',
        available: availability.available,
        userInvocable: frontmatter['user-invocable'] !== false,
        implicitInvocation:
            frontmatter['disable-model-invocation'] === true
                ? false
                : extra.allowImplicitInvocation !== false,
        emoji: openclaw.emoji,
        homepage:
            typeof frontmatter.homepage === 'string'
                ? frontmatter.homepage
                : openclaw.homepage,
        skillKey: openclaw.skillKey,
        primaryEnv: openclaw.primaryEnv,
        compatibility:
            typeof frontmatter.compatibility === 'string'
                ? frontmatter.compatibility
                : undefined,
        license:
            typeof frontmatter.license === 'string'
                ? frontmatter.license
                : undefined,
        metadata: pickMetadata(frontmatter.metadata),
        requires: openclaw.requires,
        install: availability.install,
        allowedTools,
        diagnostics,
        body: parsed.body,
        raw: input.raw,
        priority: input.target.priority
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
    const id = createHashId(input.file)

    return {
        id,
        name: basename(input.dir),
        description: '',
        path: input.file,
        dir: input.dir,
        source: input.target.source,
        scope: input.target.scope,
        remote: input.target.remote,
        state: 'invalid',
        enabled: (input.cfg.items[id]?.mode ?? 'description') !== 'off',
        available: false,
        userInvocable: true,
        implicitInvocation: false,
        diagnostics: input.diagnostics,
        body: input.body,
        raw: input.raw,
        priority: input.target.priority
    }
}

function parseExtraMetadata(content?: string): {
    allowImplicitInvocation?: boolean
    diagnostics: string[]
} {
    if (!content) return { diagnostics: [] }

    try {
        const extra = (load(content) as Record<string, unknown>) ?? {}
        const policy = extra.policy as Record<string, unknown> | undefined

        return {
            allowImplicitInvocation:
                policy?.allow_implicit_invocation === false ? false : undefined,
            diagnostics: []
        }
    } catch (error) {
        return {
            diagnostics: [
                `Failed to parse agents/openai.yaml: ${error instanceof Error ? error.message : String(error)}`
            ]
        }
    }
}

function parseAllowedTools(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) return undefined

    const items = value.split(/\s*,\s*|\s+/).filter(Boolean)
    return items.length > 0 ? items : undefined
}

function pickMetadata(value: unknown) {
    if (typeof value !== 'object' || value == null) return undefined

    const result = Object.fromEntries(
        Object.entries(value).flatMap(([k, v]) =>
            typeof v === 'string' ||
            typeof v === 'number' ||
            typeof v === 'boolean'
                ? [[k, String(v)]]
                : []
        )
    )

    return Object.keys(result).length > 0 ? result : undefined
}

function parseOpenClawMetadata(value: unknown): OpenClawMetadata {
    if (typeof value !== 'object' || value == null) return { always: false }

    const openclaw = (value as Record<string, unknown>).openclaw
    if (typeof openclaw !== 'object' || openclaw == null) {
        return { always: false }
    }

    const oc = openclaw as Record<string, unknown>
    const install = Array.isArray(oc.install)
        ? oc.install
              .map((entry) => parseInstallAction(entry))
              .filter((entry): entry is SkillInstallAction => entry != null)
        : undefined

    return {
        always: oc.always === true,
        emoji: typeof oc.emoji === 'string' ? oc.emoji : undefined,
        homepage: typeof oc.homepage === 'string' ? oc.homepage : undefined,
        skillKey: typeof oc.skillKey === 'string' ? oc.skillKey : undefined,
        primaryEnv:
            typeof oc.primaryEnv === 'string' ? oc.primaryEnv : undefined,
        os: parseStringList(oc.os),
        requires: parseRequires(oc.requires),
        install: install?.length ? install : undefined
    }
}

function parseRequires(value: unknown) {
    if (typeof value !== 'object' || value == null) return undefined

    const v = value as Record<string, unknown>
    const result: SkillRequires = {
        bins: parseStringList(v.bins),
        anyBins: parseStringList(v.anyBins),
        env: parseStringList(v.env),
        config: parseStringList(v.config)
    }

    return Object.values(result).some((e) => e?.length) ? result : undefined
}

function parseInstallAction(value: unknown): SkillInstallAction | undefined {
    if (typeof value !== 'object' || value == null) return undefined

    const v = value as Record<string, unknown>
    if (typeof v.id !== 'string' || typeof v.kind !== 'string') {
        return undefined
    }

    return {
        id: v.id,
        kind: v.kind,
        label: typeof v.label === 'string' ? v.label : undefined,
        bins: parseStringList(v.bins),
        os: parseStringList(v.os),
        formula: typeof v.formula === 'string' ? v.formula : undefined,
        package: typeof v.package === 'string' ? v.package : undefined,
        url: typeof v.url === 'string' ? v.url : undefined,
        archive: typeof v.archive === 'string' ? v.archive : undefined,
        extract: typeof v.extract === 'boolean' ? v.extract : undefined,
        stripComponents:
            typeof v.stripComponents === 'number'
                ? v.stripComponents
                : undefined,
        targetDir: typeof v.targetDir === 'string' ? v.targetDir : undefined
    }
}

function parseStringList(value: unknown) {
    if (!Array.isArray(value)) return undefined

    const result = value
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
    return result.length ? result : undefined
}

async function checkAvailability(
    meta: OpenClawMetadata,
    cfg?: AgentConfig,
    bins = new Map<string, boolean>(),
    ctx?: Context
) {
    const diagnostics: string[] = []
    const install = meta.install?.filter(
        (item) => !item.os || item.os.includes(process.platform)
    )

    if (meta.always) {
        return { available: true, diagnostics, install }
    }

    if (meta.os && !meta.os.includes(process.platform)) {
        diagnostics.push(
            `Unsupported OS: ${process.platform} (requires ${meta.os.join(', ')})`
        )
    }

    if (meta.requires?.bins?.length) {
        const missing: string[] = []
        for (const bin of meta.requires.bins) {
            if (!(await hasBin(bin, bins, ctx))) missing.push(bin)
        }
        if (missing.length) {
            diagnostics.push(`Missing required binaries: ${missing.join(', ')}`)
        }
    }

    if (meta.requires?.anyBins?.length) {
        let matched = false
        for (const bin of meta.requires.anyBins) {
            if (await hasBin(bin, bins, ctx)) {
                matched = true
                break
            }
        }
        if (!matched) {
            diagnostics.push(
                `Need one available binary: ${meta.requires.anyBins.join(', ')}`
            )
        }
    }

    if (meta.requires?.env?.length) {
        const missing = meta.requires.env.filter(
            (key) => !process.env[key]?.trim()
        )
        if (missing.length) {
            diagnostics.push(`Missing required env: ${missing.join(', ')}`)
        }
    }

    if (meta.requires?.config?.length) {
        const missing = meta.requires.config.filter(
            (key) => !hasConfigPath(cfg, key)
        )
        if (missing.length) {
            diagnostics.push(`Missing required config: ${missing.join(', ')}`)
        }
    }

    if (diagnostics.length && install?.length) {
        diagnostics.push(
            `Install options: ${install
                .map(
                    (item) =>
                        item.label ||
                        [
                            item.kind,
                            item.formula,
                            item.package,
                            item.url,
                            item.id
                        ]
                            .filter(Boolean)
                            .join(': ')
                )
                .join('; ')}`
        )
    }

    return {
        available: !diagnostics.length,
        diagnostics,
        install
    }
}

async function hasBin(
    name: string,
    cache: Map<string, boolean>,
    ctx?: Context
) {
    const computer = ctx?.chatluna_agent?.computer
    if (computer) {
        const key = `computer:${name}`
        const cached = cache.get(key)
        if (cached != null) return cached

        const ok = await computer.hasBin(name).catch(() => false)
        cache.set(key, ok)
        return ok
    }

    const key = `${process.platform}:${name}`
    const cached = cache.get(key)
    if (cached != null) return cached

    const ok = await execFileAsync(
        process.platform === 'win32' ? 'where' : 'which',
        [name]
    )
        .then(() => true)
        .catch(() => false)

    cache.set(key, ok)
    return ok
}

function hasConfigPath(cfg: AgentConfig | undefined, path: string) {
    if (!cfg) return false

    let current: unknown = cfg
    for (const part of path.split('.')) {
        if (typeof current !== 'object' || current == null) return false
        current = (current as Record<string, unknown>)[part]
    }

    return Boolean(current)
}

async function getScanTargets(
    ctx: Context,
    cfg: AgentConfig['skills']
): Promise<ScanTarget[]> {
    const root = getSkillsRootPath(ctx)
    const dirs = [...DEFAULT_SKILL_DIRS, ...cfg.dirs]
    const seen = new Set([toPathKey(root)])
    const targets: ScanTarget[] = [
        {
            root,
            source: 'chatluna',
            scope: 'data',
            priority: 0,
            remote: false
        }
    ]

    for (let idx = 0; idx < dirs.length; idx++) {
        const item = dirs[idx].trim()
        if (!item) continue

        const dir = expandDir(ctx.baseDir, item)
        const key = toPathKey(dir)
        if (seen.has(key)) continue

        seen.add(key)
        targets.push({
            root: dir,
            source: detectSkillSource(item, dir),
            scope: detectSkillScope(ctx, dir),
            priority: 100 + idx,
            remote: false
        })
    }

    return targets
}

const SOURCE_PATTERNS: [string, SkillSource][] = [
    ['/claude/skills', 'claude'],
    ['/openclaw/skills', 'openclaw'],
    ['/agents/skills', 'universal'],
    ['/codex/skills', 'codex'],
    ['/opencode/skills', 'opencode']
]

function detectSkillSource(raw: string, dir: string): SkillSource {
    const value = `${raw}\n${dir}`.replaceAll('\\', '/').toLowerCase()

    for (const [pattern, source] of SOURCE_PATTERNS) {
        if (
            value.includes(`/.${pattern.slice(1)}`) ||
            value.endsWith(pattern)
        ) {
            return source
        }
    }

    return 'custom'
}

function detectSkillScope(ctx: Context, dir: string): SkillScope {
    if (isPathInside(dir, getSkillsRootPath(ctx))) return 'data'
    if (isPathInside(dir, ctx.baseDir)) return 'project'
    return 'user'
}
