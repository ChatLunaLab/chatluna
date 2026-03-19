/** @module sub-agent/render */

import { SystemMessage } from '@langchain/core/messages'
import { SubagentContext } from 'koishi-plugin-chatluna/llm-core/agent'
import { SubAgentInfo } from '../types'
import { escapeXml } from '../utils/xml'

export function renderAvailableSubAgents(agents: SubAgentInfo[]) {
    const lines = [
        '<available_sub_agents>',
        'Delegate focused work to a specialist via the task tool when parallel work or a narrower prompt helps.',
        'If delegated work may take a while or exceed the normal tool timeout, set background=true, then query it later with task action=list/status.',
        'While a background sub-agent is running, you can send more guidance with task action=message.',
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
        'Prefer background=true for long-running delegated work so it is not interrupted by the default timeout.',
        '</available_sub_agents>'
    )

    return new SystemMessage(lines.join('\n'))
}

export function renderSubAgentSystemPrompt(
    info: SubAgentInfo,
    context: SubagentContext,
    skills?: string,
    computer?: { enabled: boolean; backends: string[]; capabilities: string[] }
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
        'If shell or computer work may take a while, use managed background execution and inspect it later instead of waiting for the default timeout.',
        'When complete, provide a clear summary of results.',
        '</sub-agent-context>'
    )

    if (computer?.enabled) {
        lines.push(
            '',
            'Computer-use capabilities are available for this sub-agent.',
            `Available capabilities: ${computer.capabilities.join(', ')}`
        )
    }

    return lines.join('\n').trim()
}
