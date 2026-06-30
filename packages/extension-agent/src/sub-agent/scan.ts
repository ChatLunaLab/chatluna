/** @module sub-agent/scan */

import { mkdir, readFile, stat } from 'fs/promises'
import { Context } from 'koishi'
import { basename } from 'path'
import { createSubAgentItemConfig } from '../config/defaults'
import { getSubAgentsRootPath } from '../config/path'
import { AgentConfig, SubAgentInfo } from '../types'
import { collectFilesRecursive } from '../utils/fs'
import { createHashId } from '../utils/id'
import { expandDir, isPathInside, toPathKey } from '../utils/path'
import { parseAgentFrontmatter } from './parse'

export { getBuiltinAgents } from './builtin'
export const REMOTE_SUBAGENTS_ROOT = '~/.chatluna/agents'

interface ScanTarget {
    root: string
    scope: 'data' | 'project' | 'user'
    priority: number
    hint?: 'chatluna' | 'claude' | 'opencode'
    remote: boolean
}

export const WRITE_TOOL_PATTERNS = [
    'file_write',
    'file_edit',
    'bash',
    'koishi_command_execute',
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
    const list = await Promise.all(
        getScanTargets(ctx, cfg).map((t) => scanTarget(t, cfg))
    )
    return list.flat().sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority
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
            hint: 'chatluna',
            remote: false
        }
    ]

    for (let idx = 0; idx < cfg.dirs.length; idx++) {
        const item = cfg.dirs[idx]?.trim()
        if (!item) continue

        const dir = expandDir(ctx.baseDir, item)
        const key = toPathKey(dir)
        if (seen.has(key)) continue

        seen.add(key)

        const combined = `${item}\n${dir}`.replaceAll('\\', '/').toLowerCase()
        const hint: ScanTarget['hint'] = combined.includes('claude/agents')
            ? 'claude'
            : combined.includes('/opencode/agents')
              ? 'opencode'
              : 'chatluna'
        const scope: ScanTarget['scope'] = isPathInside(
            dir,
            getSubAgentsRootPath(ctx)
        )
            ? 'data'
            : isPathInside(dir, ctx.baseDir)
              ? 'project'
              : 'user'

        targets.push({
            root: dir,
            scope,
            priority: 100 + idx,
            hint,
            remote: false
        })
    }

    return targets
}

async function scanTarget(target: ScanTarget, cfg: AgentConfig['subAgent']) {
    const info = await stat(target.root).catch(() => undefined)
    if (!info?.isDirectory()) return [] as SubAgentInfo[]

    const files = await collectFilesRecursive(target.root, {
        extensionFilter: '.md'
    })
    return await Promise.all(
        files.map(async (file) => {
            const raw = await readFile(file, 'utf-8').catch(() => '')
            const name = basename(file).replace(/\.md$/i, '')
            const id = createHashId(file)
            const parsed = parseAgentFrontmatter(raw, name, target.hint)

            const base = createSubAgentItemConfig({
                enabled: parsed.value?.enabled ?? true,
                dedupeTools: parsed.value?.dedupeTools,
                name: parsed.value?.name ?? name,
                description: parsed.value?.description ?? '',
                chatluna: parsed.value?.chatluna ?? true,
                character: parsed.value?.character ?? true,
                characterGroup: parsed.value?.characterGroup ?? true,
                characterPrivate: parsed.value?.characterPrivate ?? true,
                characterGroupMode: parsed.value?.characterGroupMode,
                characterPrivateMode: parsed.value?.characterPrivateMode,
                characterGroupIds: parsed.value?.characterGroupIds,
                characterPrivateIds: parsed.value?.characterPrivateIds,
                authority: parsed.value?.authority,
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
                      name: base.name,
                      description: base.description,
                      format: base.format,
                      permissions: {
                          skills:
                              saved.permissions?.skills ??
                              base.permissions.skills,
                          mcp: saved.permissions?.mcp ?? base.permissions.mcp,
                          tools:
                              saved.permissions?.tools ??
                              base.permissions.tools,
                          computer:
                              saved.permissions?.computer ??
                              base.permissions.computer
                      },
                      characterGroupIds:
                          saved.characterGroupIds ?? base.characterGroupIds,
                      characterPrivateIds:
                          saved.characterPrivateIds ?? base.characterPrivateIds
                  })
                : base

            return {
                id,
                name: item.name,
                description: item.description,
                dedupeTools: item.dedupeTools,
                source: 'markdown',
                format: item.format,
                state: parsed.state,
                enabled: item.enabled,
                chatlunaEnabled: item.chatluna,
                characterEnabled: item.character,
                characterGroupEnabled: item.characterGroup,
                characterPrivateEnabled: item.characterPrivate,
                characterGroupMode: item.characterGroupMode,
                characterPrivateMode: item.characterPrivateMode,
                characterGroupIds: item.characterGroupIds,
                characterPrivateIds: item.characterPrivateIds,
                authority: item.authority,
                hidden: item.hidden ?? false,
                remote: target.remote,
                path: file,
                scope: target.scope,
                priority: target.priority,
                promptContent:
                    parsed.value?.promptContent ?? parsed.promptContent,
                model: item.model,
                maxTurns: item.maxTurns,
                permissions: item.permissions,
                allowKoishiMessageTransform: item.allowKoishiMessageTransform,
                diagnostics: parsed.diagnostics,
                promptMode: 'markdown'
            } satisfies SubAgentInfo
        })
    )
}
