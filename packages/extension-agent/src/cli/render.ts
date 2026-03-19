/** @module cli/render */

import type { PermissionRule } from '../types'
import type {
    AgentCliOverview,
    AgentCliRunResult,
    AgentCliSessionState
} from './types'

export function renderAgentCliPrompt(
    state: AgentCliSessionState,
    info: AgentCliOverview
) {
    const lines = [
        '<agent_cli_session>',
        `Active skill: ${info.skill}`,
        `Config path: ${info.configPath}`,
        `Session permissions: ${state.permissions.join(', ')}`,
        `Overview: version=${info.version}, skills=${info.skills}, subAgents=${info.subAgents}, tools=${info.tools}, mcpServers=${info.mcpServers}, mcpTools=${info.mcpTools}`,
        `Computer backends: ${info.computerBackends.join(', ') || '(none)'}`
    ]

    if (state.pending) {
        lines.push(
            `Pending change: ${state.pending.id}`,
            `Pending summary: ${state.pending.summary}`,
            'Apply it with `agentctl apply last` or discard it with `agentctl cancel pending`.'
        )
    }

    if (state.last) {
        lines.push(
            `Last CLI result: status=${state.last.status}, exit=${state.last.exitCode}, at=${new Date(state.last.createdAt).toISOString()}`
        )
    }

    lines.push(
        'When you need config access, use the bash tool and run commands that start with `agentctl`.',
        'Use `agentctl show ...` for reads, `agentctl preview ...` before changes, `agentctl apply last` to commit the pending preview, and `agentctl cancel pending` to discard it.',
        'If bash is unavailable in the current tool set, say so instead of inventing results.',
        '</agent_cli_session>'
    )

    return lines.join('\n')
}

export function renderAgentCliResult(result: AgentCliRunResult) {
    const lines = [
        `<agent_cli_result status="${result.status}" exit_code="${result.exitCode}">`
    ]

    if (result.stdout.length > 0) {
        lines.push('stdout:')
        lines.push(...result.stdout)
    }

    if (result.stderr.length > 0) {
        lines.push('stderr:')
        lines.push(...result.stderr)
    }

    lines.push('</agent_cli_result>')
    return lines.join('\n')
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
