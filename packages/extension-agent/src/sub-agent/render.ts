/** @module sub-agent/render */

import { SystemMessage } from '@langchain/core/messages'
import {
    renderAvailableAgents,
    SubagentContext
} from 'koishi-plugin-chatluna/llm-core/agent'
import { SubAgentInfo } from '../types'
import { escapeXml } from '../utils/xml'

export function renderAvailableSubAgents(
    agents: SubAgentInfo[],
    dir?: string,
    location: 'local' | 'remote' = 'local'
) {
    return renderAvailableAgents(agents, dir, location)
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
