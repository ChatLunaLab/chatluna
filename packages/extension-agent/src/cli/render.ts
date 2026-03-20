/** @module cli/render */

import type { PermissionRule } from '../types'
import {
    AGENTCLI_PROMPT_MARKER,
    type AgentCliOverview,
    type AgentCliRunResult,
    type AgentCliSessionState
} from './types'

export function renderAgentCliPrompt(
    state: AgentCliSessionState,
    info: AgentCliOverview
) {
    const backend = info.defaultBackend
    const lines = [
        AGENTCLI_PROMPT_MARKER,
        ...indentCli(
            renderCliPairs([
                ['skill', info.skill],
                ['config', info.configPath],
                ['backend.default', backend],
                ['skills.local', info.localSkillsDir],
                ['subagents.local', info.localSubAgentsDir],
                ['skills.sandbox', info.sandboxSkillsDir],
                ['subagents.sandbox', info.sandboxSubAgentsDir],
                ['permissions', state.permissions.join(', ')],
                [
                    'skills',
                    `${info.skills} total | ${info.visibleSkills} visible | ${info.modelSkills} model`
                ],
                ['sub-agents', String(info.subAgents)],
                [
                    'tools',
                    `${info.tools} total | ${info.mainTools} main | ${info.subAgentTools} sub-agent`
                ],
                ['mcp', `${info.mcpServers} servers | ${info.mcpTools} tools`],
                ['computer', info.computerBackends.join(', ') || '(none)']
            ])
        )
    ]

    if (state.pending) {
        lines.push(
            '',
            'Pending preview',
            ...indentCli(
                renderCliPairs([
                    ['id', state.pending.id],
                    ['summary', state.pending.summary],
                    ['next', 'agentcli apply last | agentcli cancel pending']
                ])
            )
        )
    }

    if (state.last) {
        lines.push(
            '',
            'Last result',
            ...indentCli(
                renderCliPairs([
                    ['status', state.last.status],
                    ['exit', String(state.last.exitCode)],
                    ['at', new Date(state.last.createdAt).toISOString()]
                ])
            )
        )
    }

    lines.push(
        '',
        'Workflow',
        ...indentCli([
            'Use the `agentcli` tool and pass full commands that start with `agentcli`.',
            'For create, update, or config work on skills, sub-agents, tools, or MCP, run the activation sweep first.',
            'Activation sweep: `agentcli show skills`, `agentcli show subagents`, `agentcli show tools`, `agentcli show mcp servers`, `agentcli show mcp tools`.',
            'Use local ChatLuna paths as the source of truth. Do not replace them with your own machine paths.',
            backend === 'local'
                ? 'The current default computer backend is local, so write skills and sub-agents directly to the local ChatLuna paths.'
                : 'The current default computer backend is not local, so write files in the sandbox paths first, create missing directories there when needed, and finish with `agentcli sync`.',
            'Then inspect the exact target with `agentcli show ...`.',
            'Stage changes with `agentcli preview ...`; repeated preview commands append until apply or cancel, many named preview commands accept multiple targets in one call, and tool authority uses Koishi levels 0-5.',
            'Load `skill-creator` or `sub-agent-creator` before authoring those files because `agentcli` cannot create them directly.',
            'Command chains support `&`, `&&`, `|`, `|&`, `||`, and `;` inside the `command` string. Pipe operators only separate agentcli calls; they do not stream stdin.',
            'Use `agentcli sync` to bring sandbox skills and sub-agents back to local paths.',
            'If a sync preview shows overwrites, wait for the user to confirm before `agentcli apply last`.',
            'Commit with `agentcli apply last` or discard with `agentcli cancel pending`.',
            'Use `agentcli --help` or `agentcli <command> --help` when needed.',
            'If the `agentcli` tool is unavailable in this conversation, say so instead of inventing results.'
        ])
    )

    return lines.join('\n')
}

export function renderAgentCliResult(result: AgentCliRunResult) {
    const title = [
        `status=${result.status}`,
        `exit=${result.exitCode}`,
        new Date(result.createdAt).toISOString()
    ].join('  ')
    const lines = [
        `agentcli  ${title}`,
        '-'.repeat(Math.max(24, title.length + 11))
    ]

    if (result.stdout.length > 0) {
        lines.push(...result.stdout)
    }

    if (result.stderr.length > 0) {
        lines.push('', 'Errors', ...indentCli(result.stderr))
    }

    return lines.join('\n')
}

export function renderCliPairs(rows: [string, string][]) {
    const width = Math.max(...rows.map(([key]) => key.length), 0)
    return rows.map(([key, value]) => `${key.padEnd(width)}  ${value}`)
}

export function renderCliTable(headers: string[], rows: string[][]) {
    const widths = headers.map((header, idx) => {
        const values = rows.map((row) => row[idx] ?? '')
        return Math.max(
            header.length,
            ...values.map((value) => value.length),
            0
        )
    })

    return [
        headers.map((header, idx) => header.padEnd(widths[idx])).join('  '),
        widths.map((width) => '-'.repeat(width)).join('  '),
        ...rows.map((row) =>
            widths
                .map((width, idx) => (row[idx] ?? '').padEnd(width))
                .join('  ')
        )
    ]
}

export function indentCli(lines: string[], spaces = 2) {
    const pad = ' '.repeat(spaces)
    return lines.map((line) => (line ? `${pad}${line}` : ''))
}

export function renderRule(rule: PermissionRule) {
    if (rule.mode === 'allow') {
        return `allow ${rule.allow.join(', ') || '(empty)'}`
    }

    if (rule.mode === 'deny') {
        return `deny ${rule.deny.join(', ') || '(empty)'}`
    }

    if (rule.mode === 'inherit') {
        return 'inherit'
    }

    return 'all'
}
