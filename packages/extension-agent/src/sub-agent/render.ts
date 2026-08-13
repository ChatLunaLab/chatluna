import { renderAvailableAgents } from 'koishi-plugin-chatluna/llm-core/agent'
import type { SubagentContext } from 'koishi-plugin-chatluna/llm-core/agent'
import { SubAgentInfo } from '../types'

export function renderAvailableSubAgents(
    agents: SubAgentInfo[],
    dir?: string,
    location: 'local' | 'remote' = 'local'
) {
    return renderAvailableAgents(agents, dir, location)
}

export function renderSubAgentSystemPrompt(
    info: SubAgentInfo,
    subagentContext: SubagentContext,
    skills?: string,
    computer?: { enabled: boolean; backends: string[]; capabilities: string[] }
) {
    return [
        info.promptContent.trim(),
        ...(skills ? ['', skills] : []),
        '',
        '<sub-agent-context>',
        `Sub-agent "${info.name}" | depth: ${subagentContext.depth} | ` +
            `parent: ${subagentContext.traceInfo.parentAgent} | run: ${subagentContext.traceInfo.runId}`,
        'You are executing a delegated task. Do NOT delegate to other sub-agents.',
        'If the task exceeds your scope, summarize findings and return to the parent.',
        'If shell or computer work may take a while, use managed background execution and inspect it later instead of waiting for the default timeout.',
        'When complete, provide a clear summary of results.',
        '</sub-agent-context>',
        ...(computer?.enabled
            ? [
                  '',
                  'Computer-use capabilities are available for this sub-agent.',
                  `Available capabilities: ${computer.capabilities.join(', ')}`
              ]
            : [])
    ]
        .join('\n')
        .trim()
}
