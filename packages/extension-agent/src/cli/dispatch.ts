/** @module cli/dispatch */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join, posix } from 'path'
import { randomUUID } from 'crypto'
import {
    createSubAgentItemConfig,
    createToolItemConfig
} from '../config/defaults'
import { logger } from '..'
import type { ComputerSessionApi } from '../computer/types'
import { getRemoteSkillsRoot } from '../computer/materialize'
import {
    DEFAULT_SKILL_DIRS,
    getConfigPath,
    getSkillsRootPath,
    getSubAgentsRootPath
} from '../config/path'
import type { McpServerConfig, PermissionRule, SubAgentInfo } from '../types'
import { resolveTildeDir } from '../utils/path'
import { normalizeAgentCliArgv } from './parser'
import {
    AGENTCLI_SANDBOX_SUBAGENTS_ROOT,
    type AgentCliBlock,
    type AgentCliCall,
    type AgentCliCommand,
    type AgentCliCommandContext,
    type AgentCliMutation,
    type AgentCliPending,
    type AgentCliRunResult,
    type AgentCliSyncFile
} from './types'
import { indentCli, renderCliPairs, renderCliTable, renderRule } from './render'

const COMMANDS: AgentCliCommand[] = [
    {
        path: ['help'],
        description: 'Show command help',
        permission: 'read',
        execute: helpCommand
    },
    {
        path: ['show'],
        description: 'Show runtime state or config',
        permission: 'read',
        execute: showCommand
    },
    {
        path: ['preview'],
        description: 'Preview a config change',
        permission: 'write',
        execute: previewCommand
    },
    {
        path: ['sync'],
        description: 'Sync sandbox files to local',
        permission: 'write',
        execute: syncCommand
    },
    {
        path: ['apply', 'last'],
        description: 'Apply the pending preview',
        permission: 'dangerous',
        execute: applyLastCommand
    },
    {
        path: ['cancel', 'pending'],
        description: 'Discard the pending preview',
        permission: 'write',
        execute: cancelPendingCommand
    }
]

export async function runAgentCliBlock(
    ctx: Omit<AgentCliCommandContext, 'line' | 'call' | 'args'>,
    block: AgentCliBlock
) {
    const stdout: string[] = []
    const stderr: string[] = []
    let exitCode = 0
    let status: AgentCliRunResult['status'] = 'ok'

    for (const line of block.lines) {
        let lineExitCode = 0

        for (let idx = 0; idx < line.calls.length; idx++) {
            const call = line.calls[idx]
            const prev = line.calls[idx - 1]
            stdout.push(`$ ${call.raw}`)

            if (prev && !shouldRunCall(prev, lineExitCode)) {
                stdout.push(`skipped after ${prev.join}`)
                continue
            }

            try {
                const argv = normalizeAgentCliArgv(call.argv)
                const cmd = resolveCommand(argv)
                if (!cmd) {
                    throw new Error(`Unknown command: ${argv.join(' ')}`)
                }

                if (!ctx.state.permissions.includes(cmd.permission)) {
                    throw new Error(`Permission denied: ${cmd.permission}`)
                }

                const result = await cmd.execute({
                    ...ctx,
                    line,
                    call,
                    args: argv.slice(cmd.path.length)
                })

                if (result.stdout?.length) {
                    stdout.push(...result.stdout)
                }

                if (result.stderr?.length) {
                    stderr.push(...result.stderr)
                }

                if (result.pending) {
                    ctx.state.pending = result.pending
                }

                if (result.clearPending) {
                    delete ctx.state.pending
                }

                if (result.status) {
                    status = result.status
                } else if (status === 'error') {
                    status = 'ok'
                }

                lineExitCode = 0
                exitCode = 0
            } catch (error) {
                lineExitCode = 1
                exitCode = 1
                status = 'error'
                if (logger) {
                    logger.error(error)
                }
                stderr.push(
                    error instanceof Error ? error.message : String(error)
                )

                if (!call.join) {
                    break
                }
            }
        }

        if (lineExitCode !== 0) {
            break
        }
    }

    const createdAt = Date.now()
    const run = {
        input: block.body,
        exitCode,
        status,
        stdout,
        stderr,
        createdAt
    } satisfies AgentCliRunResult

    ctx.state.last = run
    ctx.state.updatedAt = createdAt
    return run
}

function resolveCommand(argv: string[]) {
    let found: AgentCliCommand | undefined

    for (const cmd of COMMANDS) {
        if (argv.length < cmd.path.length) {
            continue
        }

        if (cmd.path.every((item, idx) => argv[idx] === item)) {
            if (!found || cmd.path.length > found.path.length) {
                found = cmd
            }
        }
    }

    return found
}

function shouldRunCall(call: AgentCliCall, exitCode: number) {
    if (call.join === '&&') {
        return exitCode === 0
    }

    if (call.join === '||') {
        return exitCode !== 0
    }

    return true
}

async function helpCommand(ctx: AgentCliCommandContext) {
    return { stdout: helpLines(ctx.args) }
}

async function showCommand(ctx: AgentCliCommandContext) {
    if (ctx.args.length < 1) {
        return { stdout: helpLines(['show']) }
    }

    if (ctx.args[0] === 'overview') {
        return { stdout: showOverview(ctx) }
    }

    if (ctx.args[0] === 'skills') {
        return { stdout: showSkills(ctx) }
    }

    if (ctx.args[0] === 'skill') {
        return { stdout: showSkill(ctx, ctx.args[1]) }
    }

    if (ctx.args[0] === 'subagents') {
        return { stdout: showSubAgents(ctx) }
    }

    if (ctx.args[0] === 'subagent') {
        return { stdout: showSubAgent(ctx, ctx.args[1], ctx.args[2]) }
    }

    if (ctx.args[0] === 'tools') {
        return { stdout: showTools(ctx) }
    }

    if (ctx.args[0] === 'tool') {
        return { stdout: showTool(ctx, ctx.args[1]) }
    }

    if (ctx.args[0] === 'mcp' && ctx.args[1] === 'servers') {
        return { stdout: showMcpServers(ctx) }
    }

    if (ctx.args[0] === 'mcp' && ctx.args[1] === 'server') {
        return { stdout: showMcpServer(ctx, ctx.args[2]) }
    }

    if (ctx.args[0] === 'mcp' && ctx.args[1] === 'tools') {
        return { stdout: showMcpTools(ctx) }
    }

    if (ctx.args[0] === 'mcp' && ctx.args[1] === 'tool') {
        return { stdout: showMcpTool(ctx, ctx.args[2]) }
    }

    if (ctx.args[0] === 'computer') {
        return { stdout: showComputer(ctx) }
    }

    if (ctx.args[0] === 'session') {
        return { stdout: showSession(ctx) }
    }

    if (ctx.args[0] === 'pending') {
        return { stdout: showPending(ctx) }
    }

    return { stdout: helpLines(['show']) }
}

async function previewCommand(ctx: AgentCliCommandContext) {
    const ops = parseMutations(ctx)
    const summary = ops.flatMap((op) => previewMutation(ctx.agent, op))
    const current = ctx.state.pending

    if (!current) {
        const pending = {
            id: randomUUID().slice(0, 8),
            ownerId: ctx.session.userId,
            commands: [ctx.call.raw],
            summary:
                ops.length === 1
                    ? (summary[0] ?? ops[0].type)
                    : `${ops.length} staged changes`,
            ops,
            createdAt: Date.now()
        } satisfies AgentCliPending

        return {
            status: 'preview' as const,
            pending,
            stdout: [
                `Preview created: ${pending.id}`,
                ...summary,
                `Pending changes: ${pending.ops.length}`,
                'Next: agentcli apply last',
                'Drop: agentcli cancel pending'
            ]
        }
    }

    if (current.ownerId !== ctx.session.userId) {
        throw new Error('Pending preview belongs to a different user session')
    }

    const pending = {
        ...current,
        commands: [...current.commands, ctx.call.raw],
        summary: `${current.ops.length + ops.length} staged changes`,
        ops: [...current.ops, ...ops]
    } satisfies AgentCliPending

    return {
        status: 'preview' as const,
        pending,
        stdout: [
            `Preview updated: ${pending.id}`,
            ...summary,
            `Pending changes: ${pending.ops.length}`,
            'Next: agentcli apply last',
            'Drop: agentcli cancel pending'
        ]
    }
}

async function syncCommand(ctx: AgentCliCommandContext) {
    const target = parseSyncTarget(ctx.args[0])
    if (ctx.args.length > 1) {
        throw new Error('Usage: sync [skills|subagents|all]')
    }

    const session = await ctx.agent.computer.getOrCreateSession({
        conversationId: ctx.conversationId,
        userId: ctx.session.userId
    })

    if (session.backend === 'local') {
        return {
            stdout: [
                'Current computer backend is local. Sandbox sync is not needed.',
                `Local skills dir: ${getSkillsRootPath(ctx.agent.ctx)}`,
                `Local sub-agents dir: ${getSubAgentsRootPath(ctx.agent.ctx)}`
            ]
        }
    }

    const plan = await buildSyncPlan(ctx, session, target)
    if (plan.files.length < 1) {
        return {
            stdout: [
                `No sandbox ${formatSyncTarget(target)} changes to sync from ${session.backend}.`,
                ...plan.info
            ]
        }
    }

    const pending = {
        id: randomUUID().slice(0, 8),
        ownerId: ctx.session.userId,
        commands: [ctx.call.raw],
        summary: plan.summary,
        ops: [
            {
                type: 'sync_sandbox',
                backend: session.backend,
                files: plan.files
            } satisfies AgentCliMutation
        ],
        createdAt: Date.now()
    } satisfies AgentCliPending

    return {
        status: 'preview' as const,
        pending,
        stdout: [
            `Preview created: ${pending.id}`,
            ...plan.info,
            '',
            'Files to write',
            ...indentCli(plan.preview),
            `Pending changes: ${pending.ops.length}`,
            'Next: agentcli apply last',
            'Drop: agentcli cancel pending'
        ]
    }
}

async function applyLastCommand(ctx: AgentCliCommandContext) {
    const pending = ctx.state.pending
    if (!pending) {
        throw new Error('No pending preview in this session')
    }

    if (pending.ownerId !== ctx.session.userId) {
        throw new Error('Pending preview belongs to a different user session')
    }

    for (const op of pending.ops) {
        await applyMutation(ctx.agent, op)
    }

    return {
        status: 'applied' as const,
        clearPending: true,
        stdout: [
            `Applied preview ${pending.id}`,
            `Changes: ${pending.ops.length}`,
            `Summary: ${pending.summary}`
        ]
    }
}

async function cancelPendingCommand(ctx: AgentCliCommandContext) {
    const pending = ctx.state.pending
    if (!pending) {
        throw new Error('No pending preview in this session')
    }

    if (pending.ownerId !== ctx.session.userId) {
        throw new Error('Pending preview belongs to a different user session')
    }

    return {
        status: 'cancelled' as const,
        clearPending: true,
        stdout: [
            `Cancelled preview ${pending.id}`,
            `Changes: ${pending.ops.length}`,
            `Summary: ${pending.summary}`
        ]
    }
}

function showOverview(ctx: AgentCliCommandContext) {
    const status = ctx.agent.getStatus()
    return [
        'Overview',
        ...indentCli(
            renderCliPairs([
                ['config', getConfigPath(ctx.agent.ctx)],
                ['backend.default', status.computer.defaultProvider],
                ['skills.local', getSkillsRootPath(ctx.agent.ctx)],
                ['subagents.local', getSubAgentsRootPath(ctx.agent.ctx)],
                ['skills.sandbox', getRemoteSkillsRoot()],
                ['subagents.sandbox', AGENTCLI_SANDBOX_SUBAGENTS_ROOT],
                ['version', String(ctx.agent.args.config.version)],
                [
                    'skills',
                    `total=${status.skills.total} visible=${status.skills.visible} model=${status.skills.modelEnabled}`
                ],
                [
                    'sub-agents',
                    `total=${status.subAgent.total} running=${status.subAgent.runs.length}`
                ],
                [
                    'tools',
                    `total=${status.tool.total} main=${status.tool.mainEnabled} sub-agents=${status.tool.subAgentEnabled}`
                ],
                [
                    'mcp',
                    `servers=${Object.keys(status.mcp.servers).length} tools=${Object.keys(status.mcp.tools).length} connected=${status.mcp.connected}`
                ],
                [
                    'computer',
                    `default=${status.computer.defaultProvider} activeSessions=${status.computer.activeSessions}`
                ]
            ])
        )
    ]
}

function showSkills(ctx: AgentCliCommandContext) {
    const list = ctx.agent.skills.listSkills()
    if (list.length < 1) {
        return ['No skills found']
    }

    return [
        'Skills',
        ...indentCli(
            renderCliTable(
                [
                    'NAME',
                    'ENABLED',
                    'STATE',
                    'MODEL',
                    'USER',
                    'SOURCE',
                    'SCOPE'
                ],
                list.map((item) => [
                    item.name,
                    item.enabled ? 'yes' : 'no',
                    item.state,
                    item.modelEnabled ? 'yes' : 'no',
                    item.userInvocable ? 'yes' : 'no',
                    item.source,
                    item.scope
                ])
            )
        )
    ]
}

function showSkill(ctx: AgentCliCommandContext, raw?: string) {
    const item = selectSkill(ctx.agent, raw)
    const lines = [
        'Skill',
        ...indentCli(
            renderCliPairs([
                ['name', item.name],
                ['id', item.id],
                ['description', item.description],
                ['source', item.source],
                ['scope', item.scope],
                ['state', item.state],
                ['enabled', String(item.enabled)],
                ['visible', String(item.visible)],
                ['model', String(item.modelEnabled)],
                ['user', String(item.userInvocable)],
                ['implicit', String(item.implicitInvocation)],
                ['path', item.path]
            ])
        )
    ]

    if (item.allowedTools?.length) {
        lines.push(
            '',
            'Allowed tools',
            ...indentCli([item.allowedTools.join(', ')])
        )
    }

    if (item.diagnostics.length) {
        lines.push('', 'Diagnostics', ...indentCli(item.diagnostics))
    }

    return lines
}

function showSubAgents(ctx: AgentCliCommandContext) {
    const list = ctx.agent.subAgent.getCatalogSync()
    if (list.length < 1) {
        return ['No sub-agents found']
    }

    return [
        'Sub-agents',
        ...indentCli(
            renderCliTable(
                ['SELECTOR', 'ENABLED', 'STATE', 'HIDDEN', 'MODEL'],
                list.map((item) => [
                    `${item.source}:${item.name}`,
                    item.enabled ? 'yes' : 'no',
                    item.state,
                    item.hidden ? 'yes' : 'no',
                    item.model ?? '(default)'
                ])
            )
        )
    ]
}

function showSubAgent(
    ctx: AgentCliCommandContext,
    raw?: string,
    view?: string
) {
    const item = selectSubAgent(ctx.agent, raw)
    const lines = [
        'Sub-agent',
        ...indentCli(
            renderCliPairs([
                ['name', item.name],
                ['id', item.id],
                ['source', item.source],
                ['state', item.state],
                ['enabled', String(item.enabled)],
                ['hidden', String(item.hidden)],
                ['model', item.model ?? '(default)'],
                ['maxTurns', String(item.maxTurns ?? '(default)')],
                ['path', item.path ?? '(none)'],
                ['tools', renderRule(item.permissions.tools)],
                ['skills', renderRule(item.permissions.skills)],
                ['mcp', renderRule(item.permissions.mcp)],
                ['computer', renderRule(item.permissions.computer)]
            ])
        )
    ]

    if (view === 'effective') {
        lines.push(
            '',
            'Effective access',
            ...indentCli(showSubAgentEffective(ctx.agent, item))
        )
    }

    return lines
}

function showSubAgentEffective(
    agent: AgentCliCommandContext['agent'],
    item: SubAgentInfo
) {
    const skills = agent.skills
        .listSkills()
        .filter(
            (info) =>
                info.modelEnabled && info.enabled && info.state === 'ready'
        )
        .map((info) => info.name)
    const tools = agent.permission
        .listTools()
        .filter((info) => agent.permission.canUseTool(item, info.name))
        .map((info) => info.name)
    const rule = agent.permission.mergeRule(
        item.permissions.mcp,
        agent.args.config.subAgent.defaults.mcp
    )
    const servers = Object.keys(agent.args.config.mcp.mcpServers).filter(
        (name) => matchRule(name, rule)
    )
    const backends = agent.permission.filterComputerBackends(
        item,
        agent.computer.listAvailableBackends()
    )

    return renderCliPairs([
        [
            'skills',
            agent.permission.filterSkillNames(item, skills).join(', ') ||
                '(none)'
        ],
        ['tools', tools.join(', ') || '(none)'],
        ['mcp servers', servers.join(', ') || '(none)'],
        ['computer', backends.join(', ') || '(none)']
    ])
}

function showTools(ctx: AgentCliCommandContext) {
    const list = ctx.agent.permission.listTools()
    if (list.length < 1) {
        return ['No tools found']
    }

    return [
        'Tools',
        ...indentCli(
            renderCliTable(
                ['NAME', 'ENABLED', 'MAIN', 'AUTH', 'SUB-AGENTS', 'SOURCE'],
                list.map((item) => [
                    item.name,
                    item.enabled ? 'yes' : 'no',
                    item.main ? 'yes' : 'no',
                    String(item.authority),
                    renderRule(item.subAgents),
                    [item.source ?? '(unknown)', item.group]
                        .filter(Boolean)
                        .join('/') || '(unknown)'
                ])
            )
        )
    ]
}

function showTool(ctx: AgentCliCommandContext, raw?: string) {
    const item = selectTool(ctx.agent, raw)
    return [
        'Tool',
        ...indentCli(
            renderCliPairs([
                ['name', item.name],
                ['description', item.description ?? '(none)'],
                ['enabled', String(item.enabled)],
                ['main', String(item.main)],
                ['authority', String(item.authority)],
                ['source', item.source ?? '(unknown)'],
                ['group', item.group ?? '(none)'],
                ['tags', item.tags?.join(', ') || '(none)'],
                ['sub-agents', renderRule(item.subAgents)],
                ['mcp', String(item.isMcp)],
                ['server', item.serverName ?? '(none)']
            ])
        )
    ]
}

function showMcpServers(ctx: AgentCliCommandContext) {
    const list = Object.values(ctx.agent.mcp.getStatus().servers)
    if (list.length < 1) {
        return ['No MCP servers found']
    }

    return [
        'MCP servers',
        ...indentCli(
            renderCliTable(
                ['NAME', 'STATE', 'CONNECTED', 'TOOLS', 'TYPE', 'ENDPOINT'],
                list.map((item) => [
                    item.name,
                    item.state,
                    item.connected ? 'yes' : 'no',
                    String(item.toolCount),
                    item.type,
                    item.endpoint
                ])
            )
        )
    ]
}

function showMcpServer(ctx: AgentCliCommandContext, name?: string) {
    if (!name) {
        throw new Error('Usage: show mcp server <name>')
    }

    const status = ctx.agent.mcp.getStatus().servers[name]
    const cfg = ctx.agent.args.config.mcp.mcpServers[name]
    if (!cfg || !status) {
        throw new Error(`MCP server not found: ${name}`)
    }

    return [
        'MCP server',
        ...indentCli(
            renderCliPairs([
                ['name', name],
                ['connected', String(status.connected)],
                ['state', status.state],
                ['error', status.error ?? '(none)'],
                ['tools', String(status.toolCount)],
                ['type', status.type],
                ['endpoint', status.endpoint]
            ])
        ),
        '',
        'Config',
        ...indentCli(JSON.stringify(maskServerConfig(cfg), null, 2).split('\n'))
    ]
}

function showMcpTools(ctx: AgentCliCommandContext) {
    const list = Object.values(ctx.agent.mcp.getStatus().tools)
    if (list.length < 1) {
        return ['No MCP tools found']
    }

    return [
        'MCP tools',
        ...indentCli(
            renderCliTable(
                ['NAME', 'ENABLED', 'SERVER', 'TIMEOUT', 'SELECTOR'],
                list.map((item) => [
                    item.name,
                    item.enabled ? 'yes' : 'no',
                    item.server,
                    `${item.timeout}s`,
                    item.selector.join(', ') || '(none)'
                ])
            )
        )
    ]
}

function showMcpTool(ctx: AgentCliCommandContext, name?: string) {
    if (!name) {
        throw new Error('Usage: show mcp tool <name>')
    }

    const item = ctx.agent.mcp.getStatus().tools[name]
    if (!item) {
        throw new Error(`MCP tool not found: ${name}`)
    }

    return [
        'MCP tool',
        ...indentCli(
            renderCliPairs([
                ['name', item.name],
                ['description', item.description ?? '(none)'],
                ['enabled', String(item.enabled)],
                ['server', item.server],
                ['timeout', `${item.timeout}s`],
                ['selector', item.selector.join(', ') || '(none)']
            ])
        )
    ]
}

function showComputer(ctx: AgentCliCommandContext) {
    const status = ctx.agent.computer.getStatus()
    const lines = [
        'Computer',
        ...indentCli(
            renderCliPairs([
                ['defaultProvider', status.defaultProvider],
                ['activeSessions', String(status.activeSessions)]
            ])
        )
    ]

    const rows = Object.values(status.backends).map((item) => [
        item.type,
        item.state !== 'unsupported' ? 'yes' : 'no',
        item.state,
        String(item.sessionCount),
        item.capabilities.join(', ') || '(none)',
        item.error ?? '(none)'
    ])

    if (rows.length > 0) {
        lines.push(
            '',
            'Backends',
            ...indentCli(
                renderCliTable(
                    [
                        'TYPE',
                        'ENABLED',
                        'STATE',
                        'SESSIONS',
                        'CAPABILITIES',
                        'ERROR'
                    ],
                    rows
                )
            )
        )
    }

    lines.push(
        '',
        'Config',
        ...indentCli(
            renderCliPairs([
                [
                    'local.shell',
                    ctx.agent.args.config.computer.local.preferredShell
                ],
                [
                    'local.network',
                    ctx.agent.args.config.computer.local.networkPolicy
                ],
                [
                    'local.scopePath',
                    ctx.agent.args.config.computer.local.scopePath ||
                        '(workspace)'
                ],
                [
                    'e2b.enabled',
                    String(ctx.agent.args.config.computer.e2b.enabled)
                ],
                [
                    'e2b.apiKey',
                    ctx.agent.args.config.computer.e2b.apiKey
                        ? '(set)'
                        : '(empty)'
                ],
                [
                    'openTerminal.enabled',
                    String(ctx.agent.args.config.computer.openTerminal.enabled)
                ],
                [
                    'openTerminal.apiKey',
                    ctx.agent.args.config.computer.openTerminal.apiKey
                        ? '(set)'
                        : '(empty)'
                ]
            ])
        )
    )

    return lines
}

function showSession(ctx: AgentCliCommandContext) {
    return [
        'Session',
        ...indentCli(
            renderCliPairs([
                ['conversationId', ctx.state.conversationId],
                ['userId', ctx.state.userId],
                ['permissions', ctx.state.permissions.join(', ')],
                ['updatedAt', new Date(ctx.state.updatedAt).toISOString()],
                ['pending', ctx.state.pending?.id ?? '(none)'],
                ['last', ctx.state.last?.status ?? '(none)']
            ])
        )
    ]
}

function showPending(ctx: AgentCliCommandContext) {
    const pending = ctx.state.pending
    if (!pending) {
        return ['No pending preview in this session']
    }

    return [
        'Pending preview',
        ...indentCli(
            renderCliPairs([
                ['id', pending.id],
                ['owner', pending.ownerId],
                ['createdAt', new Date(pending.createdAt).toISOString()],
                ['changes', String(pending.ops.length)],
                ['commands', String(pending.commands.length)],
                ['latest', pending.commands[pending.commands.length - 1]],
                ['summary', pending.summary]
            ])
        )
    ]
}

function parseMutations(ctx: AgentCliCommandContext): AgentCliMutation[] {
    const args = ctx.args
    if (args.length < 1) {
        throw new Error('Usage: preview <mutation>')
    }

    if (args[0] === 'enable' && args[1] === 'skill') {
        const names = args.slice(2)
        if (names.length < 1) {
            throw new Error('Usage: preview enable skill <name|id...>')
        }

        return names.map((name) => {
            const item = selectSkill(ctx.agent, name)
            return {
                type: 'set_skill_enabled',
                id: item.id,
                enabled: true,
                label: item.name
            }
        })
    }

    if (args[0] === 'disable' && args[1] === 'skill') {
        const names = args.slice(2)
        if (names.length < 1) {
            throw new Error('Usage: preview disable skill <name|id...>')
        }

        return names.map((name) => {
            const item = selectSkill(ctx.agent, name)
            return {
                type: 'set_skill_enabled',
                id: item.id,
                enabled: false,
                label: item.name
            }
        })
    }

    if (args[0] === 'remove' && args[1] === 'skill') {
        const names = args.slice(2)
        if (names.length < 1) {
            throw new Error('Usage: preview remove skill <name|id...>')
        }

        return names.map((name) => {
            const item = selectSkill(ctx.agent, name)
            return {
                type: 'remove_skill',
                id: item.id,
                label: item.name
            }
        })
    }

    if ((args[0] === 'enable' || args[0] === 'disable') && args[1] === 'tool') {
        const enabled = args[0] === 'enable'
        const main = args.at(-1) === '--main' || args.at(-1) === '--main-agent'
        const names = args.slice(2, main ? -1 : undefined)

        if (names.length < 1 || names.some((name) => name.startsWith('--'))) {
            throw new Error(
                'Usage: preview <enable|disable> tool <name...> [--main]'
            )
        }

        return names.map((name) => {
            const item = selectTool(ctx.agent, name)
            if (main) {
                return {
                    type: 'set_tool_main',
                    name: item.name,
                    main: enabled
                }
            }

            return {
                type: 'set_tool_enabled',
                name: item.name,
                enabled
            }
        })
    }

    if (args[0] === 'enable' && args[1] === 'subagent') {
        const names = args.slice(2)
        if (names.length < 1) {
            throw new Error('Usage: preview enable subagent <selector...>')
        }

        return names.map((name) => {
            const item = selectSubAgent(ctx.agent, name)
            return {
                type: 'set_subagent_enabled',
                id: item.id,
                enabled: true,
                label: `${item.source}:${item.name}`
            }
        })
    }

    if (args[0] === 'disable' && args[1] === 'subagent') {
        const names = args.slice(2)
        if (names.length < 1) {
            throw new Error('Usage: preview disable subagent <selector...>')
        }

        return names.map((name) => {
            const item = selectSubAgent(ctx.agent, name)
            return {
                type: 'set_subagent_enabled',
                id: item.id,
                enabled: false,
                label: `${item.source}:${item.name}`
            }
        })
    }

    if (args[0] === 'remove' && args[1] === 'subagent') {
        const names = args.slice(2)
        if (names.length < 1) {
            throw new Error('Usage: preview remove subagent <selector...>')
        }

        return names.map((name) => {
            const item = selectSubAgent(ctx.agent, name)
            return {
                type: 'remove_subagent',
                id: item.id,
                label: `${item.source}:${item.name}`
            }
        })
    }

    if (args[0] === 'set' && args[1] === 'subagent') {
        const idx = args.findIndex(
            (arg, idx) =>
                idx >= 3 &&
                (arg === 'tools' ||
                    arg === 'skills' ||
                    arg === 'mcp' ||
                    arg === 'computer')
        )
        const field = idx > -1 ? args[idx] : undefined
        if (
            field !== 'tools' &&
            field !== 'skills' &&
            field !== 'mcp' &&
            field !== 'computer'
        ) {
            throw new Error(
                'Usage: preview set subagent <id...> <tools|skills|mcp|computer> <all|allow|deny|inherit> [items...]'
            )
        }

        const names = args.slice(2, idx)
        if (names.length < 1) {
            throw new Error(
                'Usage: preview set subagent <id...> <tools|skills|mcp|computer> <all|allow|deny|inherit> [items...]'
            )
        }

        return names.map((name) => {
            const item = selectSubAgent(ctx.agent, name)
            return {
                type: 'set_subagent_rule',
                id: item.id,
                field,
                rule: parseRule(args[idx + 1], args.slice(idx + 2), true),
                label: `${item.source}:${item.name}`
            }
        })
    }

    if (args[0] === 'set' && args[1] === 'tool') {
        const idx = args.findIndex(
            (arg, idx) =>
                idx >= 3 &&
                (arg === 'enabled' ||
                    arg === 'main' ||
                    arg === 'authority' ||
                    arg === 'subagents')
        )
        if (idx < 0) {
            throw new Error(
                'Usage: preview set tool <name...> <enabled|main|authority|subagents> ...'
            )
        }

        const names = args.slice(2, idx)
        if (names.length < 1) {
            throw new Error(
                'Usage: preview set tool <name...> <enabled|main|authority|subagents> ...'
            )
        }

        if (args[idx] === 'enabled') {
            return names.map((name) => {
                const item = selectTool(ctx.agent, name)
                return {
                    type: 'set_tool_enabled',
                    name: item.name,
                    enabled: parseBool(args[idx + 1])
                }
            })
        }

        if (args[idx] === 'main') {
            return names.map((name) => {
                const item = selectTool(ctx.agent, name)
                return {
                    type: 'set_tool_main',
                    name: item.name,
                    main: parseBool(args[idx + 1])
                }
            })
        }

        if (args[idx] === 'authority') {
            return names.map((name) => {
                const item = selectTool(ctx.agent, name)
                return {
                    type: 'set_tool_authority',
                    name: item.name,
                    authority: parseAuthority(args[idx + 1])
                }
            })
        }

        if (args[idx] === 'subagents') {
            return names.map((name) => {
                const item = selectTool(ctx.agent, name)
                return {
                    type: 'set_tool_subagents',
                    name: item.name,
                    rule: parseRule(args[idx + 1], args.slice(idx + 2))
                }
            })
        }

        throw new Error(
            'Usage: preview set tool <name...> <enabled|main|authority|subagents> ...'
        )
    }

    if (args[0] === 'set' && args[1] === 'mcp' && args[2] === 'tool') {
        if (args.at(-2) !== 'enabled') {
            throw new Error(
                'Usage: preview set mcp tool <name...> enabled <bool>'
            )
        }

        const names = args.slice(3, -2)
        if (names.length < 1) {
            throw new Error(
                'Usage: preview set mcp tool <name...> enabled <bool>'
            )
        }

        return names.map((name) => {
            const item = ctx.agent.mcp.getStatus().tools[name]
            if (!item) {
                throw new Error(`MCP tool not found: ${name}`)
            }

            return {
                type: 'set_mcp_tool_enabled',
                name: item.name,
                enabled: parseBool(args[args.length - 1])
            }
        })
    }

    if (args[0] === 'save' && args[1] === 'mcp' && args[2] === 'server') {
        if (args[4] !== 'json') {
            throw new Error('Usage: preview save mcp server <name> json <json>')
        }

        if (!args[5]) {
            throw new Error('Missing MCP server JSON payload')
        }

        return [
            {
                type: 'save_mcp_server',
                name: args[3],
                config: JSON.parse(args[5]) as McpServerConfig
            }
        ]
    }

    if (args[0] === 'remove' && args[1] === 'mcp' && args[2] === 'server') {
        const names = args.slice(3)
        if (names.length < 1) {
            throw new Error('Usage: preview remove mcp server <name...>')
        }

        return names.map((name) => {
            if (!ctx.agent.args.config.mcp.mcpServers[name]) {
                throw new Error(`MCP server not found: ${name}`)
            }

            return {
                type: 'remove_mcp_server',
                name
            }
        })
    }

    throw new Error(`Unsupported preview command: ${ctx.call.raw}`)
}

function previewMutation(
    agent: AgentCliCommandContext['agent'],
    op: AgentCliMutation
) {
    if (op.type === 'set_skill_enabled') {
        const item = selectSkill(agent, op.id)
        return [`skill ${item.name}: enabled ${item.enabled} -> ${op.enabled}`]
    }

    if (op.type === 'remove_skill') {
        return [`skill ${op.label}: remove from local catalog and config`]
    }

    if (op.type === 'set_subagent_enabled') {
        const item = selectSubAgent(agent, op.id)
        return [
            `subagent ${op.label}: enabled ${item.enabled} -> ${op.enabled}`
        ]
    }

    if (op.type === 'remove_subagent') {
        return [`subagent ${op.label}: remove from local registry`]
    }

    if (op.type === 'set_subagent_rule') {
        const item = selectSubAgent(agent, op.id)
        return [
            `subagent ${op.label}: ${op.field} ${renderRule(item.permissions[op.field])} -> ${renderRule(op.rule)}`
        ]
    }

    if (op.type === 'set_tool_enabled') {
        const item = selectTool(agent, op.name)
        return [
            `tool ${item.name}: global enabled ${item.enabled} -> ${op.enabled}`
        ]
    }

    if (op.type === 'set_tool_main') {
        const item = selectTool(agent, op.name)
        return [`tool ${item.name}: main agent ${item.main} -> ${op.main}`]
    }

    if (op.type === 'set_tool_subagents') {
        const item = selectTool(agent, op.name)
        return [
            `tool ${item.name}: sub-agents ${renderRule(item.subAgents)} -> ${renderRule(op.rule)}`
        ]
    }

    if (op.type === 'set_tool_authority') {
        const item = selectTool(agent, op.name)
        return [
            `tool ${item.name}: authority ${item.authority} -> ${op.authority}`
        ]
    }

    if (op.type === 'set_mcp_tool_enabled') {
        const item = agent.mcp.getStatus().tools[op.name]
        return [
            `mcp tool ${op.name}: enabled ${item?.enabled} -> ${op.enabled}`
        ]
    }

    if (op.type === 'save_mcp_server') {
        const existed = !!agent.args.config.mcp.mcpServers[op.name]
        return [
            `mcp server ${op.name}: ${existed ? 'update' : 'create'}`,
            ...JSON.stringify(maskServerConfig(op.config), null, 2).split('\n')
        ]
    }

    if (op.type === 'sync_sandbox') {
        const created = op.files.filter((item) => item.mode === 'create').length
        const updated = op.files.length - created
        return [
            `sync sandbox from ${op.backend}: create ${created}, overwrite ${updated}`
        ]
    }

    if (op.type === 'remove_mcp_server') {
        return [`mcp server ${op.name}: remove`]
    }

    return []
}

async function applyMutation(
    agent: AgentCliCommandContext['agent'],
    op: AgentCliMutation
) {
    if (op.type === 'set_skill_enabled') {
        await agent.setSkillEnabled(op.id, op.enabled)
        return
    }

    if (op.type === 'remove_skill') {
        await agent.removeSkill(op.id)
        return
    }

    if (op.type === 'set_subagent_enabled') {
        await agent.setSubAgentEnabled(op.id, op.enabled)
        return
    }

    if (op.type === 'remove_subagent') {
        await agent.removeSubAgent(op.id)
        return
    }

    if (op.type === 'set_subagent_rule') {
        await saveSubAgentRule(agent, op)
        return
    }

    if (op.type === 'set_tool_enabled') {
        const tool = {
            items: { ...agent.args.config.tool.items },
            registry: { ...(agent.args.config.tool.registry ?? {}) }
        }
        const item = createToolItemConfig(tool.items[op.name], op.name)
        item.enabled = op.enabled
        tool.items[op.name] = item
        await agent.saveToolConfig(tool)
        return
    }

    if (op.type === 'set_tool_main') {
        const tool = {
            items: { ...agent.args.config.tool.items },
            registry: { ...(agent.args.config.tool.registry ?? {}) }
        }
        const item = createToolItemConfig(tool.items[op.name], op.name)
        item.main = op.main
        tool.items[op.name] = item
        await agent.saveToolConfig(tool)
        return
    }

    if (op.type === 'set_tool_subagents') {
        const tool = {
            items: { ...agent.args.config.tool.items },
            registry: { ...(agent.args.config.tool.registry ?? {}) }
        }
        const item = createToolItemConfig(tool.items[op.name], op.name)
        item.subAgents = op.rule
        tool.items[op.name] = item
        await agent.saveToolConfig(tool)
        return
    }

    if (op.type === 'set_tool_authority') {
        const tool = {
            items: { ...agent.args.config.tool.items },
            registry: { ...(agent.args.config.tool.registry ?? {}) }
        }
        const item = createToolItemConfig(tool.items[op.name], op.name)
        item.authority = op.authority
        tool.items[op.name] = item
        await agent.saveToolConfig(tool)
        return
    }

    if (op.type === 'set_mcp_tool_enabled') {
        const item = agent.mcp.getStatus().tools[op.name]
        if (!item) {
            throw new Error(`MCP tool not found: ${op.name}`)
        }

        await agent.saveMcpTool({
            name: item.name,
            enabled: op.enabled,
            timeout: item.timeout,
            selector: item.selector
        })
        return
    }

    if (op.type === 'save_mcp_server') {
        await agent.saveMcpServer({
            name: op.name,
            config: op.config
        })
        return
    }

    if (op.type === 'sync_sandbox') {
        await applySync(agent, op.files)
        return
    }

    if (op.type === 'remove_mcp_server') {
        await agent.removeMcpServer(op.name)
    }
}

async function saveSubAgentRule(
    agent: AgentCliCommandContext['agent'],
    op: Extract<AgentCliMutation, { type: 'set_subagent_rule' }>
) {
    const info = selectSubAgent(agent, op.id)

    if (info.source === 'manual') {
        await agent.subAgent.registerManualAgent({
            id: info.id,
            name: info.name,
            description: info.description,
            promptContent: info.promptContent,
            format: info.format,
            model: info.model,
            maxTurns: info.maxTurns,
            hidden: info.hidden,
            enabled: info.enabled,
            allowKoishiMessageTransform: info.allowKoishiMessageTransform,
            permissions: {
                ...info.permissions,
                [op.field]: op.rule
            },
            promptMode: info.promptMode,
            preset: info.preset
        })
        return
    }

    const subAgent = structuredClone(agent.args.config.subAgent)
    const item = createSubAgentItemConfig({
        enabled: info.enabled,
        name: info.name,
        description: info.description,
        source: info.source,
        format: info.format,
        model: info.model,
        maxTurns: info.maxTurns,
        hidden: info.hidden,
        promptMode: info.promptMode,
        preset: info.preset,
        allowKoishiMessageTransform: info.allowKoishiMessageTransform,
        permissions: {
            ...info.permissions,
            [op.field]: op.rule
        }
    })

    if (info.source === 'builtin') {
        subAgent.builtin[info.name] = item
    } else if (info.source === 'preset') {
        subAgent.presetAgents[info.name] = item
    } else {
        subAgent.items[info.id] = item
    }

    await agent.saveSubAgentConfig(subAgent)
}

function selectSkill(agent: AgentCliCommandContext['agent'], raw?: string) {
    if (!raw) {
        throw new Error('Usage: show skill <name|id>')
    }

    const list = agent.skills.listSkills().filter((item) => {
        return item.id === raw || item.name === raw
    })

    if (list.length < 1) {
        throw new Error(`Skill not found: ${raw}`)
    }

    if (list.length > 1) {
        throw new Error(`Skill selector is ambiguous: ${raw}`)
    }

    return list[0]
}

function selectSubAgent(agent: AgentCliCommandContext['agent'], raw?: string) {
    if (!raw) {
        throw new Error('Usage: show subagent <name|id>')
    }

    const list = agent.subAgent.getCatalogSync().filter((item) => {
        return (
            item.id === raw ||
            item.name === raw ||
            `${item.source}:${item.name}` === raw
        )
    })

    if (list.length < 1) {
        throw new Error(`Sub-agent not found: ${raw}`)
    }

    if (list.length > 1) {
        throw new Error(`Sub-agent selector is ambiguous: ${raw}`)
    }

    return list[0]
}

function selectTool(agent: AgentCliCommandContext['agent'], raw?: string) {
    if (!raw) {
        throw new Error('Usage: show tool <name>')
    }

    const item = agent.permission.listTools().find((info) => info.name === raw)
    if (!item) {
        throw new Error(`Tool not found: ${raw}`)
    }

    return item
}

function parseBool(raw?: string) {
    if (!raw) {
        throw new Error('Missing boolean value')
    }

    const value = raw.toLowerCase()

    if (['true', '1', 'yes', 'on', 'enable', 'enabled'].includes(value)) {
        return true
    }

    if (['false', '0', 'no', 'off', 'disable', 'disabled'].includes(value)) {
        return false
    }

    throw new Error(`Invalid boolean value: ${raw}`)
}

function parseAuthority(raw?: string) {
    if (!raw) {
        throw new Error('Missing authority value')
    }

    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0 || value > 5) {
        throw new Error(`Invalid authority value: ${raw}. Expected 0-5`)
    }

    return value
}

function parseRule(
    raw: string | undefined,
    names: string[],
    allowInherit = false
) {
    if (!raw) {
        throw new Error('Missing permission mode')
    }

    const mode = raw.toLowerCase()

    if (mode === 'all') {
        return { mode: 'all', allow: [], deny: [] } satisfies PermissionRule
    }

    if (allowInherit && mode === 'inherit') {
        return {
            mode: 'inherit',
            allow: [],
            deny: []
        } satisfies PermissionRule
    }

    if (mode === 'allow') {
        return {
            mode: 'allow',
            allow: names,
            deny: []
        } satisfies PermissionRule
    }

    if (mode === 'deny') {
        return {
            mode: 'deny',
            allow: [],
            deny: names
        } satisfies PermissionRule
    }

    throw new Error(`Invalid permission mode: ${raw}`)
}

function matchRule(name: string, rule: PermissionRule) {
    if (rule.mode === 'allow') {
        return rule.allow.includes(name)
    }

    if (rule.mode === 'deny') {
        return !rule.deny.includes(name)
    }

    return true
}

function maskServerConfig(cfg: McpServerConfig) {
    const next = structuredClone(cfg) as Record<string, unknown>

    if (typeof next['env'] === 'object' && next['env'] != null) {
        next['env'] = Object.fromEntries(
            Object.keys(next['env'] as Record<string, unknown>).map((key) => [
                key,
                '***'
            ])
        )
    }

    if (typeof next['headers'] === 'object' && next['headers'] != null) {
        next['headers'] = Object.fromEntries(
            Object.keys(next['headers'] as Record<string, unknown>).map(
                (key) => [key, '***']
            )
        )
    }

    if (typeof next['apiKey'] === 'string' && next['apiKey']) {
        next['apiKey'] = '***'
    }

    return next
}

async function applySync(
    agent: AgentCliCommandContext['agent'],
    files: AgentCliSyncFile[]
) {
    for (const item of files) {
        await mkdir(dirname(item.targetPath), { recursive: true })
        await writeFile(item.targetPath, item.content, 'utf-8')
    }

    if (files.some((item) => item.kind === 'skill')) {
        await agent.skills.reload()
    }

    if (files.some((item) => item.kind === 'subagent')) {
        await agent.subAgent.reload()
    }

    await agent.refreshConsoleData()
}

function parseSyncTarget(raw?: string) {
    if (!raw || raw === 'all') {
        return 'all' as const
    }

    if (raw === 'skills' || raw === 'skill') {
        return 'skills' as const
    }

    if (
        raw === 'subagents' ||
        raw === 'subagent' ||
        raw === 'sub-agents' ||
        raw === 'sub-agent'
    ) {
        return 'subagents' as const
    }

    throw new Error('Usage: sync [skills|subagents|all]')
}

function formatSyncTarget(target: 'all' | 'skills' | 'subagents') {
    if (target === 'skills') {
        return 'skill'
    }

    if (target === 'subagents') {
        return 'sub-agent'
    }

    return 'skill/sub-agent'
}

async function buildSyncPlan(
    ctx: AgentCliCommandContext,
    session: ComputerSessionApi,
    target: 'all' | 'skills' | 'subagents'
) {
    const skillRoots =
        target === 'subagents'
            ? []
            : Array.from(
                  new Map(
                      [
                          getSkillsRootPath(ctx.agent.ctx),
                          ...DEFAULT_SKILL_DIRS.map((item) =>
                              resolveTildeDir(ctx.agent.ctx.baseDir, item)
                          ),
                          ...ctx.agent.args.config.skills.dirs
                              .map((item) => item.trim())
                              .filter(Boolean)
                              .map((item) =>
                                  resolveTildeDir(ctx.agent.ctx.baseDir, item)
                              )
                      ].map((item) => [
                          item.replaceAll('\\', '/').toLowerCase(),
                          item
                      ])
                  ).values()
              )
    const subAgentRoot = getSubAgentsRootPath(ctx.agent.ctx)
    const skill =
        target === 'subagents'
            ? { files: [], unchanged: 0 }
            : await collectSyncFiles(
                  session,
                  'skill',
                  getRemoteSkillsRoot(),
                  skillRoots
              )
    const subagent =
        target === 'skills'
            ? { files: [], unchanged: 0 }
            : await collectSyncFiles(
                  session,
                  'subagent',
                  AGENTCLI_SANDBOX_SUBAGENTS_ROOT,
                  [subAgentRoot]
              )
    const files = [...skill.files, ...subagent.files]
    const created = files.filter((item) => item.mode === 'create').length
    const updated = files.length - created
    const unchanged = skill.unchanged + subagent.unchanged
    const rows: [string, string][] = [['backend', session.backend]]
    const info = ['Sync sandbox']

    if (target !== 'subagents') {
        rows.push(['skills.sandbox', getRemoteSkillsRoot()])
        rows.push(['skills.primary', getSkillsRootPath(ctx.agent.ctx)])
        rows.push(['skills.targets', String(skillRoots.length)])
    }

    if (target !== 'skills') {
        rows.push(['subagents.sandbox', AGENTCLI_SANDBOX_SUBAGENTS_ROOT])
        rows.push(['subagents.local', subAgentRoot])
    }

    rows.push(['create', String(created)])
    rows.push(['overwrite', String(updated)])
    rows.push(['unchanged', String(unchanged)])

    info.push(...indentCli(renderCliPairs(rows)))

    if (target !== 'subagents' && skillRoots.length > 0) {
        info.push(
            '',
            'Skill targets',
            ...indentCli(skillRoots.map((item) => item.replaceAll('\\', '/')))
        )
    }

    return {
        files,
        summary: `sync sandbox from ${session.backend}: ${created} new, ${updated} overwrite`,
        info,
        preview:
            files.length > 12
                ? [
                      ...files
                          .slice(0, 12)
                          .map(
                              (item) =>
                                  `${item.mode} ${item.kind} ${item.targetPath.replaceAll('\\', '/')}`
                          ),
                      `... ${files.length - 12} more`
                  ]
                : files.map(
                      (item) =>
                          `${item.mode} ${item.kind} ${item.targetPath.replaceAll('\\', '/')}`
                  )
    }
}

async function collectSyncFiles(
    session: ComputerSessionApi,
    kind: AgentCliSyncFile['kind'],
    remoteRoot: string,
    localRoots: string[]
) {
    const files: AgentCliSyncFile[] = []
    let unchanged = 0

    for (const file of await listRemoteFiles(session, remoteRoot)) {
        const sourcePath = posix.join(remoteRoot, file)
        const content = await session.readFile(sourcePath)

        for (const localRoot of localRoots) {
            const targetPath = join(localRoot, ...file.split('/'))
            const current = await readFile(targetPath, 'utf-8').catch(
                (err: NodeJS.ErrnoException) => {
                    if (err.code === 'ENOENT') {
                        return undefined
                    }

                    throw err
                }
            )

            if (current === content) {
                unchanged += 1
                continue
            }

            files.push({
                kind,
                path: file,
                sourcePath,
                targetPath,
                content,
                mode: current == null ? 'create' : 'update'
            })
        }
    }

    return { files, unchanged }
}

async function listRemoteFiles(session: ComputerSessionApi, root: string) {
    const result = await session.execute(
        `[ -d ${root} ] && find ${root} -type f -printf '%P\\n' || true`
    )

    if (result.stderr.trim()) {
        throw new Error(result.stderr.trim())
    }

    return result.stdout
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
}

function helpLines(args: string[] = []) {
    const topic = args[0]

    if (topic === 'show') {
        return renderHelp({
            title: 'agentcli show',
            about: 'Inspect runtime state and persisted config.',
            usage: ['agentcli show <target>', 'agentcli show <target> --help'],
            label: 'Targets',
            rows: [
                ['overview', 'Show config path and high-level counts'],
                ['skills', 'List discovered skills'],
                ['skill <name|id>', 'Show one skill in detail'],
                ['subagents', 'List registered sub-agents'],
                ['subagent <selector> [effective]', 'Show one sub-agent'],
                ['tools', 'List tool catalog and routing'],
                ['tool <name>', 'Show one tool in detail'],
                ['mcp servers', 'List MCP servers'],
                ['mcp server <name>', 'Show one MCP server'],
                ['mcp tools', 'List MCP tools'],
                ['mcp tool <name>', 'Show one MCP tool'],
                ['computer', 'Show computer backends and config'],
                ['session', 'Show current CLI session state'],
                ['pending', 'Show the current preview, if any']
            ],
            examples: [
                'agentcli show overview',
                'agentcli show subagent builtin:plan effective',
                'agentcli show tool bash'
            ]
        })
    }

    if (topic === 'preview') {
        return renderHelp({
            title: 'agentcli preview',
            about: 'Stage one or more config changes without applying them yet.',
            usage: ['agentcli preview <mutation>', 'agentcli preview --help'],
            label: 'Mutations',
            rows: [
                ['enable skill <name|id...>', 'Enable one or more skills'],
                ['disable skill <name|id...>', 'Disable one or more skills'],
                [
                    'remove skill <name|id...>',
                    'Remove one or more local skills'
                ],
                [
                    'enable subagent <selector...>',
                    'Enable one or more sub-agents'
                ],
                [
                    'disable subagent <selector...>',
                    'Disable one or more sub-agents'
                ],
                [
                    'remove subagent <selector...>',
                    'Remove one or more removable sub-agents'
                ],
                [
                    'set subagent <selector...> <field> <rule> [items...]',
                    'Update one or more sub-agent permission rules'
                ],
                ['enable tool <name...>', 'Enable one or more tools globally'],
                [
                    'disable tool <name...>',
                    'Disable one or more tools globally'
                ],
                [
                    'enable tool <name...> --main',
                    'Enable one or more tools for the main agent'
                ],
                [
                    'disable tool <name...> --main',
                    'Disable one or more tools for the main agent'
                ],
                [
                    'set tool <name...> <enabled|main|authority|subagents> ...',
                    'Update one or more tools'
                ],
                [
                    'set mcp tool <name...> enabled <bool>',
                    'Toggle one or more MCP tools'
                ],
                [
                    'save mcp server <name> json <json>',
                    'Create or update one MCP server'
                ],
                [
                    'remove mcp server <name...>',
                    'Remove one or more MCP servers'
                ]
            ],
            notes: [
                'Supported sub-agent fields: tools, skills, mcp, computer.',
                'Supported rules: all, allow, deny, and inherit for sub-agent fields.',
                'Supported tool authority values: 0 to 5.',
                'Repeated `agentcli preview ...` commands in the same session append to the same pending preview until apply or cancel.',
                'Named preview commands accept multiple targets when the syntax uses `<name...>` or `<selector...>`.',
                'Quote JSON payloads so shell parsing keeps them intact.',
                'Use `agentcli apply last` to commit the preview.',
                'Use `agentcli cancel pending` to discard it.'
            ],
            examples: [
                'agentcli preview enable skill coding-agent onboard delight',
                'agentcli preview disable tool bash file_edit file_write --main',
                'agentcli preview set tool bash grep authority 3',
                'agentcli preview set tool bash grep subagents allow builtin:general',
                'agentcli preview set mcp tool filesystem_read filesystem_write enabled false',
                'agentcli preview disable tool bash --main && agentcli preview disable tool file_edit file_write --main',
                'agentcli preview save mcp server filesystem json \'{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}\''
            ]
        })
    }

    if (topic === 'sync') {
        return renderHelp({
            title: 'agentcli sync',
            about: 'Stage sandbox skills or sub-agents so they can be written back to local storage and compatibility roots.',
            usage: ['agentcli sync [skills|subagents|all]'],
            notes: [
                'Sync reads files from the current remote computer session.',
                'Skill sync fans out to ChatLuna and compatibility directories such as .agents/skills, .openclaw/skills, .codex/skills, .claude/skills, and OpenCode skill roots.',
                'Files are staged as a preview first; use `agentcli apply last` to write them locally.',
                'If the preview shows overwrites, confirm with the user before applying it.'
            ],
            examples: [
                'agentcli sync',
                'agentcli sync skills',
                'agentcli sync subagents'
            ]
        })
    }

    if (topic === 'apply') {
        return renderHelp({
            title: 'agentcli apply last',
            about: 'Commit the current pending preview.',
            usage: ['agentcli apply last'],
            notes: [
                'Only the user who created the preview can apply it.',
                'This clears the pending preview after a successful save.'
            ],
            examples: ['agentcli apply last']
        })
    }

    if (topic === 'cancel') {
        return renderHelp({
            title: 'agentcli cancel pending',
            about: 'Discard the current pending preview.',
            usage: ['agentcli cancel pending'],
            notes: ['Only the user who created the preview can cancel it.'],
            examples: ['agentcli cancel pending']
        })
    }

    if (topic && topic !== 'help') {
        return [`Unknown help topic: ${topic}`, '', ...helpLines()]
    }

    return renderHelp({
        title: 'agentcli',
        about: 'ChatLuna agent control CLI for skills, tools, sub-agents, MCP, and computer settings.',
        usage: [
            'agentcli <command> [options]',
            'agentcli --help',
            'agentcli <command> --help'
        ],
        label: 'Commands',
        rows: [
            ['help', 'Show general or command help'],
            ['show', 'Inspect runtime state or config'],
            ['preview', 'Stage one or more config changes'],
            ['sync', 'Stage sandbox skills or sub-agents back to local'],
            ['apply last', 'Apply the current pending preview'],
            ['cancel pending', 'Discard the current pending preview']
        ],
        notes: [
            'Run read commands first, then stage one focused preview or append more changes to the current one.',
            'A preview is session-scoped and stays pending until apply or cancel.',
            'Repeated `preview` commands append to the pending preview until apply or cancel.',
            'Many named preview commands accept multiple targets, including skills, sub-agents, tools, MCP tools, and removable MCP servers.',
            'Tool authority can be staged with `preview set tool <name...> authority <0-5>`.',
            'Main-agent tool routing supports `preview disable tool <name...> --main`.',
            'Command chains support `&`, `&&`, `|`, `|&`, `||`, and `;`.',
            'Use `agentcli sync` when sandbox-created skills or sub-agents need to come back to local storage.'
        ],
        examples: [
            'agentcli show overview',
            'agentcli show subagent builtin:plan effective',
            'agentcli sync',
            'agentcli preview set mcp tool filesystem_read filesystem_write enabled false',
            'agentcli preview set tool bash grep authority 3',
            'agentcli preview disable tool bash file_edit file_write --main',
            'agentcli preview set tool bash subagents allow builtin:general',
            'agentcli apply last'
        ]
    })
}

function renderHelp(input: {
    title: string
    about: string
    usage: string[]
    label?: string
    rows?: [string, string][]
    notes?: string[]
    examples?: string[]
}) {
    const lines = [
        input.title,
        input.about,
        '',
        'Usage',
        ...indentCli(input.usage)
    ]

    if (input.rows && input.rows.length > 0) {
        lines.push(
            '',
            input.label ?? 'Commands',
            ...indentCli(renderCliTable(['COMMAND', 'DESCRIPTION'], input.rows))
        )
    }

    if (input.notes && input.notes.length > 0) {
        lines.push('', 'Notes', ...indentCli(input.notes))
    }

    if (input.examples && input.examples.length > 0) {
        lines.push('', 'Examples', ...indentCli(input.examples))
    }

    return lines
}
