/** @module sub-agent/render */

import { SystemMessage } from '@langchain/core/messages'
import { SubagentContext } from 'koishi-plugin-chatluna/llm-core/agent'
import { SubAgentInfo } from '../types'
import { escapeXml } from '../utils/xml'

export function renderAvailableSubAgents(agents: SubAgentInfo[]) {
    const lines = [
        '<available_sub_agents>',
        'Delegate focused work to a specialist via the task tool when parallel work or a narrower prompt helps.',
        ''
    ]

    for (const item of agents) {
        lines.push(
            '  <sub_agent>',
            `    <name>${escapeXml(item.name)}</name>`,
            `    <description>${escapeXml(item.description)}</description>`,
            '  </sub_agent>'
        )
    }

    lines.push(
        '',
        'Use the exact sub-agent name. Provide a self-contained prompt with goal, context, and expected result.',
        '</available_sub_agents>'
    )

    return new SystemMessage(lines.join('\n'))
}

export function renderSubAgentSystemPrompt(
    info: SubAgentInfo,
    context: SubagentContext,
    skills?: string,
    computer?: { enabled: boolean; capabilities: string[] }
) {
    const lines = [info.promptContent.trim()]

    if (skills) {
        lines.push('', skills)
    }

    lines.push(
        '',
        '<sub-agent-context>',
        `Sub-agent "${info.name}" | depth: ${context.depth} | parent: ${context.traceInfo.parentAgent} | run: ${context.traceInfo.runId}`,
        'You are executing a delegated task. Do NOT delegate to other sub-agents.',
        'If the task exceeds your scope, summarize findings and return to the parent.',
        'When complete, provide a clear summary of results.',
        '</sub-agent-context>'
    )

    if (info.permissions.computer.mode !== 'deny' && computer?.enabled) {
        lines.push(
            '',
            'Computer-use capabilities are available for this sub-agent.',
            `Available capabilities: ${computer.capabilities.join(', ')}`
        )
    }

    return lines.join('\n').trim()
}
