/** @module cli/dispatch */

import { randomUUID } from 'crypto'
import {
    createSubAgentItemConfig,
    createToolItemConfig
} from '../config/defaults'
import { getConfigPath } from '../config/path'
import type { McpServerConfig, PermissionRule, SubAgentInfo } from '../types'
import {
    type AgentCliBlock,
    type AgentCliCommand,
    type AgentCliCommandContext,
    type AgentCliMutation,
    type AgentCliPending,
    type AgentCliRunResult
} from './types'
import { renderRule } from './render'

const COMMANDS: AgentCliCommand[] = [
    {
        path: ['help'],
        description: 'Show command help',
        permission: 'read',
        execute: async () => ({ stdout: helpLines() })
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
    ctx: Omit<AgentCliCommandContext, 'line' | 'args'>,
    block: AgentCliBlock
) {
    const stdout: string[] = []
    const stderr: string[] = []
    let exitCode = 0
    let status: AgentCliRunResult['status'] = 'ok'

    for (const line of block.lines) {
        stdout.push(`$ ${line.raw}`)

        try {
            const cmd = resolveCommand(line.argv)
            if (!cmd) {
                throw new Error(`Unknown command: ${line.argv.join(' ')}`)
            }

            if (!ctx.state.permissions.includes(cmd.permission)) {
                throw new Error(`Permission denied: ${cmd.permission}`)
            }

            const result = await cmd.execute({
                ...ctx,
                line,
                args: line.argv.slice(cmd.path.length)
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
            }
        } catch (error) {
            exitCode = 1
            status = 'error'
            stderr.push(error instanceof Error ? error.message : String(error))
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

async function showCommand(ctx: AgentCliCommandContext) {
    if (ctx.args.length < 1) {
        return { stdout: helpLines('show') }
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

    return { stdout: helpLines('show') }
}

async function previewCommand(ctx: AgentCliCommandContext) {
    const op = parseMutation(ctx)
    const summary = previewMutation(ctx.agent, op)
    const pending = {
        id: randomUUID().slice(0, 8),
        ownerId: ctx.session.userId,
        command: ctx.line.raw,
        summary: summary[0] ?? op.type,
        op,
        createdAt: Date.now()
    } satisfies AgentCliPending

    return {
        status: 'preview' as const,
        pending,
        stdout: [
            `Preview created: ${pending.id}`,
            ...summary,
            'Run `apply last` to commit this change.',
            'Run `cancel pending` to discard it.'
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

    await applyMutation(ctx.agent, pending.op)
    return {
        status: 'applied' as const,
        clearPending: true,
        stdout: [`Applied preview ${pending.id}`, pending.summary]
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
        stdout: [`Cancelled preview ${pending.id}`]
    }
}

function showOverview(ctx: AgentCliCommandContext) {
    const status = ctx.agent.getStatus()
    return [
        `config: ${getConfigPath(ctx.agent.ctx)}`,
        `version: ${ctx.agent.args.config.version}`,
        `skills: total=${status.skills.total}, visible=${status.skills.visible}, model=${status.skills.modelEnabled}`,
        `subagents: total=${status.subAgent.total}, running=${status.subAgent.runs.length}`,
        `tools: total=${status.tool.total}, main=${status.tool.mainEnabled}, subagents=${status.tool.subAgentEnabled}`,
        `mcp: servers=${Object.keys(status.mcp.servers).length}, tools=${Object.keys(status.mcp.tools).length}, connected=${status.mcp.connected}`,
        `computer: default=${status.computer.defaultProvider}, activeSessions=${status.computer.activeSessions}`
    ]
}

function showSkills(ctx: AgentCliCommandContext) {
    const list = ctx.agent.skills.listSkills()
    if (list.length < 1) {
        return ['No skills found']
    }

    return list.map(
        (item) =>
            `- ${item.name} id=${item.id} enabled=${item.enabled} state=${item.state} source=${item.source} scope=${item.scope} model=${item.modelEnabled} user=${item.userInvocable}`
    )
}

function showSkill(ctx: AgentCliCommandContext, raw?: string) {
    const item = selectSkill(ctx.agent, raw)
    return [
        `name: ${item.name}`,
        `id: ${item.id}`,
        `description: ${item.description}`,
        `source: ${item.source}`,
        `scope: ${item.scope}`,
        `state: ${item.state}`,
        `enabled: ${item.enabled}`,
        `visible: ${item.visible}`,
        `modelEnabled: ${item.modelEnabled}`,
        `userInvocable: ${item.userInvocable}`,
        `implicitInvocation: ${item.implicitInvocation}`,
        `path: ${item.path}`,
        ...(item.allowedTools?.length
            ? [`allowedTools: ${item.allowedTools.join(', ')}`]
            : []),
        ...(item.diagnostics.length
            ? [`diagnostics: ${item.diagnostics.join(' | ')}`]
            : [])
    ]
}

function showSubAgents(ctx: AgentCliCommandContext) {
    const list = ctx.agent.subAgent.getCatalogSync()
    if (list.length < 1) {
        return ['No sub-agents found']
    }

    return list.map(
        (item) =>
            `- ${item.source}:${item.name} id=${item.id} enabled=${item.enabled} state=${item.state} hidden=${item.hidden} model=${item.model ?? '(default)'}`
    )
}

function showSubAgent(
    ctx: AgentCliCommandContext,
    raw?: string,
    view?: string
) {
    const item = selectSubAgent(ctx.agent, raw)
    const lines = [
        `name: ${item.name}`,
        `id: ${item.id}`,
        `source: ${item.source}`,
        `state: ${item.state}`,
        `enabled: ${item.enabled}`,
        `hidden: ${item.hidden}`,
        `model: ${item.model ?? '(default)'}`,
        `maxTurns: ${item.maxTurns ?? '(default)'}`,
        `path: ${item.path ?? '(none)'}`,
        `tools rule: ${renderRule(item.permissions.tools)}`,
        `skills rule: ${renderRule(item.permissions.skills)}`,
        `mcp rule: ${renderRule(item.permissions.mcp)}`,
        `computer rule: ${renderRule(item.permissions.computer)}`
    ]

    if (view === 'effective') {
        lines.push(...showSubAgentEffective(ctx.agent, item))
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

    return [
        'effective:',
        `  skills: ${agent.permission.filterSkillNames(item, skills).join(', ') || '(none)'}`,
        `  tools: ${tools.join(', ') || '(none)'}`,
        `  mcp servers: ${servers.join(', ') || '(none)'}`,
        `  computer backends: ${backends.join(', ') || '(none)'}`
    ]
}

function showTools(ctx: AgentCliCommandContext) {
    const list = ctx.agent.permission.listTools()
    if (list.length < 1) {
        return ['No tools found']
    }

    return list.map(
        (item) =>
            `- ${item.name} enabled=${item.enabled} main=${item.main} source=${item.source ?? '(unknown)'} group=${item.group ?? '(none)'} subAgents=${renderRule(item.subAgents)}`
    )
}

function showTool(ctx: AgentCliCommandContext, raw?: string) {
    const item = selectTool(ctx.agent, raw)
    return [
        `name: ${item.name}`,
        `description: ${item.description ?? '(none)'}`,
        `enabled: ${item.enabled}`,
        `main: ${item.main}`,
        `source: ${item.source ?? '(unknown)'}`,
        `group: ${item.group ?? '(none)'}`,
        `tags: ${item.tags?.join(', ') || '(none)'}`,
        `subAgents: ${renderRule(item.subAgents)}`,
        `isMcp: ${item.isMcp}`,
        `server: ${item.serverName ?? '(none)'}`
    ]
}

function showMcpServers(ctx: AgentCliCommandContext) {
    const list = Object.values(ctx.agent.mcp.getStatus().servers)
    if (list.length < 1) {
        return ['No MCP servers found']
    }

    return list.map(
        (item) =>
            `- ${item.name} connected=${item.connected} state=${item.state} tools=${item.toolCount} type=${item.type} endpoint=${item.endpoint}`
    )
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
        `name: ${name}`,
        `connected: ${status.connected}`,
        `state: ${status.state}`,
        `error: ${status.error ?? '(none)'}`,
        `tools: ${status.toolCount}`,
        `type: ${status.type}`,
        `endpoint: ${status.endpoint}`,
        'config:',
        ...JSON.stringify(maskServerConfig(cfg), null, 2).split('\n')
    ]
}

function showMcpTools(ctx: AgentCliCommandContext) {
    const list = Object.values(ctx.agent.mcp.getStatus().tools)
    if (list.length < 1) {
        return ['No MCP tools found']
    }

    return list.map(
        (item) =>
            `- ${item.name} enabled=${item.enabled} server=${item.server} timeout=${item.timeout}s selector=${item.selector.join(', ') || '(none)'}`
    )
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
        `name: ${item.name}`,
        `description: ${item.description ?? '(none)'}`,
        `enabled: ${item.enabled}`,
        `server: ${item.server}`,
        `timeout: ${item.timeout}s`,
        `selector: ${item.selector.join(', ') || '(none)'}`
    ]
}

function showComputer(ctx: AgentCliCommandContext) {
    const status = ctx.agent.computer.getStatus()
    const lines = [
        `defaultProvider: ${status.defaultProvider}`,
        `activeSessions: ${status.activeSessions}`
    ]

    for (const item of Object.values(status.backends)) {
        lines.push(
            `- ${item.type} enabled=${item.state !== 'unsupported'} state=${item.state} sessions=${item.sessionCount} capabilities=${item.capabilities.join(', ') || '(none)'} error=${item.error ?? '(none)'}`
        )
    }

    lines.push(
        `local.shell: ${ctx.agent.args.config.computer.local.preferredShell}`,
        `local.network: ${ctx.agent.args.config.computer.local.networkPolicy}`,
        `local.scopePath: ${ctx.agent.args.config.computer.local.scopePath || '(workspace)'}`,
        `e2b.enabled: ${ctx.agent.args.config.computer.e2b.enabled}`,
        `e2b.apiKey: ${ctx.agent.args.config.computer.e2b.apiKey ? '(set)' : '(empty)'}`,
        `openTerminal.enabled: ${ctx.agent.args.config.computer.openTerminal.enabled}`,
        `openTerminal.apiKey: ${ctx.agent.args.config.computer.openTerminal.apiKey ? '(set)' : '(empty)'}`
    )

    return lines
}

function showSession(ctx: AgentCliCommandContext) {
    return [
        `conversationId: ${ctx.state.conversationId}`,
        `userId: ${ctx.state.userId}`,
        `permissions: ${ctx.state.permissions.join(', ')}`,
        `updatedAt: ${new Date(ctx.state.updatedAt).toISOString()}`,
        `pending: ${ctx.state.pending?.id ?? '(none)'}`,
        `last: ${ctx.state.last?.status ?? '(none)'}`
    ]
}

function showPending(ctx: AgentCliCommandContext) {
    const pending = ctx.state.pending
    if (!pending) {
        return ['No pending preview in this session']
    }

    return [
        `id: ${pending.id}`,
        `owner: ${pending.ownerId}`,
        `createdAt: ${new Date(pending.createdAt).toISOString()}`,
        `command: ${pending.command}`,
        `summary: ${pending.summary}`
    ]
}

function parseMutation(ctx: AgentCliCommandContext): AgentCliMutation {
    const args = ctx.args
    if (args.length < 1) {
        throw new Error('Usage: preview <mutation>')
    }

    if (args[0] === 'enable' && args[1] === 'skill') {
        const item = selectSkill(ctx.agent, args[2])
        return {
            type: 'set_skill_enabled',
            id: item.id,
            enabled: true,
            label: item.name
        }
    }

    if (args[0] === 'disable' && args[1] === 'skill') {
        const item = selectSkill(ctx.agent, args[2])
        return {
            type: 'set_skill_enabled',
            id: item.id,
            enabled: false,
            label: item.name
        }
    }

    if (args[0] === 'remove' && args[1] === 'skill') {
        const item = selectSkill(ctx.agent, args[2])
        return {
            type: 'remove_skill',
            id: item.id,
            label: item.name
        }
    }

    if (args[0] === 'enable' && args[1] === 'subagent') {
        const item = selectSubAgent(ctx.agent, args[2])
        return {
            type: 'set_subagent_enabled',
            id: item.id,
            enabled: true,
            label: `${item.source}:${item.name}`
        }
    }

    if (args[0] === 'disable' && args[1] === 'subagent') {
        const item = selectSubAgent(ctx.agent, args[2])
        return {
            type: 'set_subagent_enabled',
            id: item.id,
            enabled: false,
            label: `${item.source}:${item.name}`
        }
    }

    if (args[0] === 'remove' && args[1] === 'subagent') {
        const item = selectSubAgent(ctx.agent, args[2])
        return {
            type: 'remove_subagent',
            id: item.id,
            label: `${item.source}:${item.name}`
        }
    }

    if (args[0] === 'set' && args[1] === 'subagent') {
        const item = selectSubAgent(ctx.agent, args[2])
        const field = args[3]
        if (
            field !== 'tools' &&
            field !== 'skills' &&
            field !== 'mcp' &&
            field !== 'computer'
        ) {
            throw new Error(
                'Usage: preview set subagent <id> <tools|skills|mcp|computer> <all|allow|deny|inherit> [items...]'
            )
        }

        return {
            type: 'set_subagent_rule',
            id: item.id,
            field,
            rule: parseRule(args[4], args.slice(5), true),
            label: `${item.source}:${item.name}`
        }
    }

    if (args[0] === 'set' && args[1] === 'tool') {
        const item = selectTool(ctx.agent, args[2])
        if (args[3] === 'enabled') {
            return {
                type: 'set_tool_enabled',
                name: item.name,
                enabled: parseBool(args[4])
            }
        }

        if (args[3] === 'main') {
            return {
                type: 'set_tool_main',
                name: item.name,
                main: parseBool(args[4])
            }
        }

        if (args[3] === 'subagents') {
            return {
                type: 'set_tool_subagents',
                name: item.name,
                rule: parseRule(args[4], args.slice(5))
            }
        }

        throw new Error(
            'Usage: preview set tool <name> <enabled|main|subagents> ...'
        )
    }

    if (args[0] === 'set' && args[1] === 'mcp' && args[2] === 'tool') {
        if (args[4] !== 'enabled') {
            throw new Error('Usage: preview set mcp tool <name> enabled <bool>')
        }

        const item = ctx.agent.mcp.getStatus().tools[args[3]]
        if (!item) {
            throw new Error(`MCP tool not found: ${args[3]}`)
        }

        return {
            type: 'set_mcp_tool_enabled',
            name: item.name,
            enabled: parseBool(args[5])
        }
    }

    if (args[0] === 'save' && args[1] === 'mcp' && args[2] === 'server') {
        if (args[4] !== 'json') {
            throw new Error('Usage: preview save mcp server <name> json <json>')
        }

        const idx = ctx.line.raw.indexOf(' json ')
        const raw = idx > -1 ? ctx.line.raw.slice(idx + 6).trim() : ''
        if (!raw) {
            throw new Error('Missing MCP server JSON payload')
        }

        return {
            type: 'save_mcp_server',
            name: args[3],
            config: JSON.parse(raw) as McpServerConfig
        }
    }

    if (args[0] === 'remove' && args[1] === 'mcp' && args[2] === 'server') {
        if (!ctx.agent.args.config.mcp.mcpServers[args[3]]) {
            throw new Error(`MCP server not found: ${args[3]}`)
        }

        return {
            type: 'remove_mcp_server',
            name: args[3]
        }
    }

    throw new Error(`Unsupported preview command: ${ctx.line.raw}`)
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
        return [`tool ${item.name}: enabled ${item.enabled} -> ${op.enabled}`]
    }

    if (op.type === 'set_tool_main') {
        const item = selectTool(agent, op.name)
        return [`tool ${item.name}: main ${item.main} -> ${op.main}`]
    }

    if (op.type === 'set_tool_subagents') {
        const item = selectTool(agent, op.name)
        return [
            `tool ${item.name}: subAgents ${renderRule(item.subAgents)} -> ${renderRule(op.rule)}`
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

    return [`mcp server ${op.name}: remove`]
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
        const tool = structuredClone(agent.args.config.tool)
        const item = createToolItemConfig(tool.items[op.name])
        item.enabled = op.enabled
        tool.items[op.name] = item
        await agent.saveToolConfig(tool)
        return
    }

    if (op.type === 'set_tool_main') {
        const tool = structuredClone(agent.args.config.tool)
        const item = createToolItemConfig(tool.items[op.name])
        item.main = op.main
        tool.items[op.name] = item
        await agent.saveToolConfig(tool)
        return
    }

    if (op.type === 'set_tool_subagents') {
        const tool = structuredClone(agent.args.config.tool)
        const item = createToolItemConfig(tool.items[op.name])
        item.subAgents = op.rule
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

    await agent.removeMcpServer(op.name)
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

function helpLines(topic?: string) {
    if (topic === 'show') {
        return [
            'show overview',
            'show skills',
            'show skill <name|id>',
            'show subagents',
            'show subagent <source:name|id> [effective]',
            'show tools',
            'show tool <name>',
            'show mcp servers',
            'show mcp server <name>',
            'show mcp tools',
            'show mcp tool <name>',
            'show computer',
            'show session',
            'show pending'
        ]
    }

    return [
        'help',
        'show overview',
        'show subagent builtin:plan effective',
        'preview enable skill coding-agent',
        'preview disable subagent builtin:plan',
        'preview set subagent builtin:plan tools allow file_read glob grep',
        'preview set tool bash subagents allow builtin:general',
        'preview set mcp tool filesystem_read enabled false',
        'preview save mcp server filesystem json {"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}',
        'preview remove mcp server filesystem',
        'apply last',
        'cancel pending'
    ]
}
