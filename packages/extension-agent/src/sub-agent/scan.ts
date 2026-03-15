import { createHash } from 'crypto'
import { mkdir, readFile, readdir, stat } from 'fs/promises'
import { Context } from 'koishi'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import { createSubAgentItemConfig } from '../config/defaults'
import { getSubAgentsRootPath } from '../config/path'
import { AgentConfig, SubAgentInfo } from '../types'
import { parseAgentFrontmatter } from './parse'

export { getBuiltinAgents } from './builtin'

interface ScanTarget {
    root: string
    scope: 'data' | 'project' | 'user'
    priority: number
    hint?: 'chatluna' | 'claude' | 'opencode'
}

export const WRITE_TOOL_PATTERNS = [
    'file_write',
    'file_edit',
    'bash',
    'command_execute',
    'group_mute',
    'cron',
    'memory_add',
    'memory_delete',
    'memory_update',
    'action_'
]

export async function ensureSubAgentsRoot(ctx: Context) {
    await mkdir(getSubAgentsRootPath(ctx), { recursive: true })
}

export async function scanMarkdownAgents(
    ctx: Context,
    cfg: AgentConfig['subAgent']
) {
    const targets = getScanTargets(ctx, cfg)
    const list = await Promise.all(
        targets.map((target) => scanTarget(target, cfg))
    )
    return list.flat().sort((a, b) => {
        if (a.priority !== b.priority) {
            return a.priority - b.priority
        }

        return (a.path ?? '').localeCompare(b.path ?? '')
    })
}

function getScanTargets(ctx: Context, cfg: AgentConfig['subAgent']) {
    const root = getSubAgentsRootPath(ctx)
    const seen = new Set([toPathKey(root)])
    const targets: ScanTarget[] = [
        {
            root,
            scope: 'data',
            priority: 0,
            hint: 'chatluna'
        }
    ]

    for (let idx = 0; idx < cfg.dirs.length; idx++) {
        const item = cfg.dirs[idx]?.trim()
        if (!item) {
            continue
        }

        const dir = resolveRoot(ctx.baseDir, item)
        const key = toPathKey(dir)
        if (seen.has(key)) {
            continue
        }

        seen.add(key)
        targets.push({
            root: dir,
            scope: detectScope(ctx, dir),
            priority: 100 + idx,
            hint: detectHint(item, dir)
        })
    }

    return targets
}

async function scanTarget(target: ScanTarget, cfg: AgentConfig['subAgent']) {
    const info = await stat(target.root).catch(() => undefined)
    if (!info?.isDirectory()) {
        return [] as SubAgentInfo[]
    }

    const files = await collectMarkdownFiles(target.root)
    const list = await Promise.all(
        files.map((file) => parseMarkdownAgent(file, target, cfg))
    )
    return list as SubAgentInfo[]
}

async function parseMarkdownAgent(
    file: string,
    target: ScanTarget,
    cfg: AgentConfig['subAgent']
) {
    const raw = await readFile(file, 'utf-8').catch(() => '')
    const id = createAgentId(file)
    const parsed = parseAgentFrontmatter(
        raw,
        basename(file).replace(/\.md$/i, ''),
        target.hint
    )

    const base = createSubAgentItemConfig({
        enabled: parsed.value?.enabled ?? true,
        name: parsed.value?.name ?? basename(file).replace(/\.md$/i, ''),
        description: parsed.value?.description ?? '',
        source: 'markdown',
        format: parsed.value?.format ?? target.hint ?? 'chatluna',
        model: parsed.value?.model,
        maxTurns: parsed.value?.maxTurns,
        hidden: parsed.value?.hidden,
        promptMode: 'markdown',
        allowKoishiMessageTransform:
            parsed.value?.allowKoishiMessageTransform ?? false,
        permissions: parsed.value?.permissions
    })

    const saved = cfg.items[id]
    const item = saved
        ? createSubAgentItemConfig({
              ...base,
              ...saved,
              permissions: {
                  skills: saved.permissions?.skills ?? base.permissions.skills,
                  mcp: saved.permissions?.mcp ?? base.permissions.mcp,
                  tools: saved.permissions?.tools ?? base.permissions.tools,
                  computer:
                      saved.permissions?.computer ?? base.permissions.computer
              }
          })
        : base

    return {
        id,
        name: item.name,
        description: item.description,
        source: 'markdown',
        format: item.format,
        state: parsed.state,
        enabled: item.enabled,
        hidden: item.hidden ?? false,
        path: file,
        scope: target.scope,
        priority: target.priority,
        promptContent: parsed.value?.promptContent ?? parsed.promptContent,
        model: item.model,
        maxTurns: item.maxTurns,
        permissions: item.permissions,
        allowKoishiMessageTransform: item.allowKoishiMessageTransform,
        diagnostics: parsed.diagnostics,
        promptMode: 'markdown'
    } satisfies SubAgentInfo
}

async function collectMarkdownFiles(root: string) {
    const queue = [root]
    const result: string[] = []

    while (queue.length > 0) {
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
            if (entry.isDirectory()) {
                queue.push(file)
                continue
            }

            if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
                result.push(file)
            }
        }
    }

    return result.sort((a, b) => a.localeCompare(b))
}

function resolveRoot(baseDir: string, dir: string) {
    if (
        dir.startsWith('.claude/') ||
        dir.startsWith('.claude\\') ||
        dir.startsWith('.config/opencode/') ||
        dir.startsWith('.config\\opencode\\')
    ) {
        return resolve(homedir(), dir)
    }

    if (dir === '~') {
        return homedir()
    }

    if (dir.startsWith('~/') || dir.startsWith('~\\')) {
        return resolve(homedir(), dir.slice(2))
    }

    return resolve(baseDir, dir)
}

function detectScope(ctx: Context, dir: string) {
    if (isInside(dir, getSubAgentsRootPath(ctx))) {
        return 'data'
    }

    if (isInside(dir, ctx.baseDir)) {
        return 'project'
    }

    return 'user'
}

function detectHint(raw: string, dir: string) {
    const value = `${raw}\n${dir}`.replaceAll('\\', '/').toLowerCase()
    if (value.includes('/.claude/agents') || value.endsWith('/claude/agents')) {
        return 'claude'
    }

    if (
        value.includes('/.config/opencode/agents') ||
        value.endsWith('/opencode/agents')
    ) {
        return 'opencode'
    }

    return 'chatluna'
}

function isInside(dir: string, root: string) {
    const target = resolve(dir)
    const base = resolve(root)
    return (
        target === base ||
        target.startsWith(`${base}\\`) ||
        target.startsWith(`${base}/`)
    )
}

function toPathKey(dir: string) {
    return resolve(dir).replaceAll('\\', '/').toLowerCase()
}

function createAgentId(file: string) {
    return createHash('sha1').update(file).digest('hex').slice(0, 16)
}
