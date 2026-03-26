/** @module skills/scan */

import { execFile } from 'child_process'
import { mkdir, readdir, readFile, stat } from 'fs/promises'
import { load } from 'js-yaml'
import { Context } from 'koishi'
import { basename, dirname, join, posix } from 'path'
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
import { isPathInside, resolveTildeDir, toPathKey } from '../utils/path'
import { computeRemoteDir, isRemotePathInside } from '../utils/remote_path'
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
    const skills = (
        await Promise.all(
            targets.map((target) => scanTarget(ctx, target, cfg, bins))
        )
    ).flat()

    return skills.sort((a, b) =>
        a.priority !== b.priority
            ? a.priority - b.priority
            : a.path.localeCompare(b.path)
    )
}

export async function scanRemoteSkills(
    session: ComputerSessionApi,
    ctx: Context,
    cfg: AgentConfig
): Promise<ScannedSkill[]> {
    const targets = getRemoteScanTargets(session, cfg.skills)
    const bins = new Map<string, boolean>()
    const seen = new Set<string>()
    const skills = (
        await Promise.all(
            targets.map(async (target) => {
                const files = await listRemoteSkillFiles(session, target.root)
                return await Promise.all(
                    files.map(async (file) => {
                        if (seen.has(file)) {
                            return undefined
                        }

                        seen.add(file)
                        const dir = posix.dirname(file)
                        const raw = await session.readFile(file).catch(() => '')
                        const extra = await session
                            .readFile(posix.join(dir, 'agents', 'openai.yaml'))
                            .catch(() => undefined)

                        return await parseSkillText({
                            file,
                            dir,
                            target,
                            cfg: cfg.skills,
                            agentCfg: cfg,
                            bins,
                            ctx,
                            raw,
                            extra
                        })
                    })
                )
            })
        )
    )
        .flat(2)
        .filter((item): item is ScannedSkill => item != null)

    return skills.sort((a, b) =>
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
                .filter((file) => basename(file) === 'SKILL.md')
                .map((file) => dirname(file))
        )
    ).sort((a, b) => a.localeCompare(b))

    return await Promise.all(
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
                {
                    dirs: [],
                    items: {}
                },
                undefined,
                bins,
                ctx
            )
        )
    )
}

export async function listSkillResources(dir: string): Promise<string[]> {
    return await collectFilesRecursive(dir, {
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
        `root=${quoteShellPath(dir)} && [ -d "$root" ] && find "$root" -type f ! -name SKILL.md -print | awk -v root="$root" 'index($0, root "/") == 1 { print substr($0, length(root) + 2) }' || true`,
        {
            timeout: 10000
        }
    )

    if (result.stderr.trim()) {
        throw new Error(result.stderr.trim())
    }

    return result.stdout
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
}

async function scanTarget(
    ctx: Context,
    target: ScanTarget,
    cfg: AgentConfig,
    bins: Map<string, boolean>
): Promise<ScannedSkill[]> {
    const root = await stat(target.root).catch(() => undefined)
    if (!root?.isDirectory()) return []

    const entries = await readdir(target.root, { withFileTypes: true })
    const skills = await Promise.all(
        entries.map(async (entry) => {
            const file = join(target.root, entry.name, 'SKILL.md')
            const info = await stat(file).catch(() => undefined)
            if (!info?.isFile()) return undefined
            return parseSkill(file, target, cfg.skills, cfg, bins, ctx)
        })
    )

    return skills.filter((skill): skill is ScannedSkill => skill != null)
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

    return await parseSkillText({
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
    const fallbackName = basename(input.dir)

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
            : fallbackName
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

    const metadata = pickMetadata(frontmatter.metadata)
    const allowedTools = parseAllowedTools(frontmatter['allowed-tools'])
    const availableResult = await checkAvailability(
        openclaw,
        input.agentCfg,
        input.bins,
        input.ctx
    )
    const implicitInvocation =
        frontmatter['disable-model-invocation'] === true
            ? false
            : extra.allowImplicitInvocation !== false
    const userInvocable = frontmatter['user-invocable'] !== false
    const id = createSkillId(input.file)
    const mode =
        input.cfg.items[id]?.mode ??
        (input.cfg.items[id]?.enabled ? 'description' : 'off')
    const enabled = mode !== 'off'
    const state: SkillState = description ? 'ready' : 'invalid'

    diagnostics.push(...availableResult.diagnostics)

    return {
        id,
        name,
        description,
        path: input.file,
        dir: input.dir,
        source: input.target.source,
        scope: input.target.scope,
        remote: input.target.remote,
        state,
        enabled,
        available: availableResult.available,
        userInvocable,
        implicitInvocation,
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
        metadata,
        requires: openclaw.requires,
        install: availableResult.install,
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
    const id = createSkillId(input.file)
    const mode =
        input.cfg.items[id]?.mode ??
        (input.cfg.items[id]?.enabled ? 'description' : 'off')

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
        enabled: mode !== 'off',
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
    const diagnostics: string[] = []

    if (!content) return { diagnostics }

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

async function listRemoteSkillFiles(session: ComputerSessionApi, root: string) {
    const result = await session.execute(
        `[ -d ${quoteShellPath(root)} ] && find ${quoteShellPath(root)} -type f -name SKILL.md -print || true`,
        {
            timeout: 10000
        }
    )

    if (result.stderr.trim()) {
        throw new Error(result.stderr.trim())
    }

    return result.stdout
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
}

function parseAllowedTools(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) return undefined

    const items = value
        .split(/\s*,\s*|\s+/)
        .map((item) => item.trim())
        .filter(Boolean)

    return items.length > 0 ? items : undefined
}

function pickMetadata(value: unknown) {
    if (typeof value !== 'object' || value == null) return undefined

    const result = Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) =>
            typeof item === 'string' ||
            typeof item === 'number' ||
            typeof item === 'boolean'
                ? [[key, String(item)]]
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

    const item = openclaw as Record<string, unknown>
    const install = Array.isArray(item.install)
        ? item.install
              .map((entry) => parseInstallAction(entry))
              .filter((entry): entry is SkillInstallAction => entry != null)
        : undefined

    return {
        always: item.always === true,
        emoji: typeof item.emoji === 'string' ? item.emoji : undefined,
        homepage: typeof item.homepage === 'string' ? item.homepage : undefined,
        skillKey: typeof item.skillKey === 'string' ? item.skillKey : undefined,
        primaryEnv:
            typeof item.primaryEnv === 'string' ? item.primaryEnv : undefined,
        os: parseStringList(item.os),
        requires: parseRequires(item.requires),
        install: install?.length ? install : undefined
    }
}

function parseRequires(value: unknown) {
    if (typeof value !== 'object' || value == null) return undefined

    const item = value as Record<string, unknown>
    const result: SkillRequires = {
        bins: parseStringList(item.bins),
        anyBins: parseStringList(item.anyBins),
        env: parseStringList(item.env),
        config: parseStringList(item.config)
    }

    return Object.values(result).some((entry) => entry?.length)
        ? result
        : undefined
}

function parseInstallAction(value: unknown): SkillInstallAction | undefined {
    if (typeof value !== 'object' || value == null) return undefined

    const item = value as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.kind !== 'string') {
        return undefined
    }

    return {
        id: item.id,
        kind: item.kind,
        label: typeof item.label === 'string' ? item.label : undefined,
        bins: parseStringList(item.bins),
        os: parseStringList(item.os),
        formula: typeof item.formula === 'string' ? item.formula : undefined,
        package: typeof item.package === 'string' ? item.package : undefined,
        url: typeof item.url === 'string' ? item.url : undefined,
        archive: typeof item.archive === 'string' ? item.archive : undefined,
        extract: typeof item.extract === 'boolean' ? item.extract : undefined,
        stripComponents:
            typeof item.stripComponents === 'number'
                ? item.stripComponents
                : undefined,
        targetDir:
            typeof item.targetDir === 'string' ? item.targetDir : undefined
    }
}

function parseStringList(value: unknown) {
    if (!Array.isArray(value)) return undefined

    const result = value
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)

    return result.length ? result : undefined
}

async function checkAvailability(
    metadata: OpenClawMetadata,
    cfg?: AgentConfig,
    bins = new Map<string, boolean>(),
    ctx?: Context
) {
    const diagnostics: string[] = []
    const install = metadata.install?.filter(
        (item) => !item.os || item.os.includes(process.platform)
    )

    if (metadata.always) {
        return { available: true, diagnostics, install }
    }

    if (metadata.os && !metadata.os.includes(process.platform)) {
        diagnostics.push(
            `Unsupported OS: ${process.platform} (requires ${metadata.os.join(', ')})`
        )
    }

    if (metadata.requires?.bins?.length) {
        const missing: string[] = []
        for (const bin of metadata.requires.bins) {
            if (!(await hasBin(bin, bins, ctx))) missing.push(bin)
        }
        if (missing.length) {
            diagnostics.push(`Missing required binaries: ${missing.join(', ')}`)
        }
    }

    if (metadata.requires?.anyBins?.length) {
        let matched = false
        for (const bin of metadata.requires.anyBins) {
            if (await hasBin(bin, bins, ctx)) {
                matched = true
                break
            }
        }
        if (!matched) {
            diagnostics.push(
                `Need one available binary: ${metadata.requires.anyBins.join(', ')}`
            )
        }
    }

    if (metadata.requires?.env?.length) {
        const missing = metadata.requires.env.filter(
            (key) => !process.env[key]?.trim()
        )
        if (missing.length) {
            diagnostics.push(`Missing required env: ${missing.join(', ')}`)
        }
    }

    if (metadata.requires?.config?.length) {
        const missing = metadata.requires.config.filter(
            (key) => !hasConfigPath(cfg, key)
        )
        if (missing.length) {
            diagnostics.push(`Missing required config: ${missing.join(', ')}`)
        }
    }

    if (diagnostics.length && install?.length) {
        diagnostics.push(
            `Install options: ${install.map((item) => item.label || [item.kind, item.formula, item.package, item.url, item.id].filter(Boolean).join(': ')).join('; ')}`
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

        const dir = resolveTildeDir(ctx.baseDir, item)
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

function getRemoteScanTargets(
    session: ComputerSessionApi,
    cfg: AgentConfig['skills']
) {
    const scope = session.getScopePath().replaceAll('\\', '/').trim() || '~'
    const dirs = [...DEFAULT_SKILL_DIRS, ...cfg.dirs]
    const seen = new Set([
        REMOTE_SKILLS_ROOT.replaceAll('\\', '/').replace(/\/+$/, '') || '/'
    ])
    const targets: ScanTarget[] = [
        {
            root: REMOTE_SKILLS_ROOT,
            source: 'chatluna',
            scope: 'data',
            priority: 0,
            remote: true
        }
    ]

    for (let idx = 0; idx < dirs.length; idx++) {
        const item = dirs[idx].trim()
        if (!item) {
            continue
        }

        const dir = computeRemoteDir(scope, item)
        const key = dir.replaceAll('\\', '/').replace(/\/+$/, '') || '/'
        if (seen.has(key)) {
            continue
        }

        seen.add(key)
        targets.push({
            root: dir,
            source: detectSkillSource(item, dir),
            scope: detectRemoteSkillScope(scope, dir),
            priority: 100 + idx,
            remote: true
        })
    }

    return targets
}

function detectSkillSource(raw: string, dir: string): SkillSource {
    const value = `${raw}\n${dir}`.replaceAll('\\', '/').toLowerCase()

    if (value.includes('/.claude/skills') || value.endsWith('/claude/skills')) {
        return 'claude'
    }
    if (
        value.includes('/.openclaw/skills') ||
        value.endsWith('/openclaw/skills')
    ) {
        return 'openclaw'
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
    if (isPathInside(dir, getSkillsRootPath(ctx))) return 'data'
    if (isPathInside(dir, ctx.baseDir)) return 'project'
    return 'user'
}

function detectRemoteSkillScope(scope: string, dir: string): SkillScope {
    if (isRemotePathInside(dir, REMOTE_SKILLS_ROOT)) return 'data'
    if (isRemotePathInside(dir, scope)) return 'project'
    return 'user'
}

function createSkillId(file: string) {
    return createHashId(file)
}
