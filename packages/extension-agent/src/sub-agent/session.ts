/** @module sub-agent/session */

import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage
} from '@langchain/core/messages'
import type { AgentStep } from 'koishi-plugin-chatluna/llm-core/agent'
import type { SubAgentInfo, SubAgentRunInfo } from '../types'

export interface SubAgentTaskSession {
    id: string
    agentId: string
    agentName: string
    conversationId: string
    parentConversationId: string
    depth: number
    maxDepth: number
    parentAgent: string
    activeRunId?: string
    messages: BaseMessage[]
    startedAt: number
    updatedAt: number
}

export function createTaskSession(input: {
    id: string
    info: SubAgentInfo
    parentConversationId: string
    depth: number
    maxDepth: number
    parentAgent: string
}): SubAgentTaskSession {
    const now = Date.now()
    return {
        id: input.id,
        agentId: input.info.id,
        agentName: input.info.name,
        conversationId: `subagent:${input.id}`,
        parentConversationId: input.parentConversationId,
        depth: input.depth,
        maxDepth: input.maxDepth,
        parentAgent: input.parentAgent,
        messages: [],
        startedAt: now,
        updatedAt: now
    }
}

export function touchTaskSession(task: SubAgentTaskSession) {
    task.updatedAt = Date.now()
}

export function appendTaskMessage(
    task: SubAgentTaskSession,
    message: BaseMessage
) {
    task.messages.push(message)
    touchTaskSession(task)
}

export function appendTaskMessages(
    task: SubAgentTaskSession,
    messages: BaseMessage[]
) {
    if (messages.length < 1) {
        return
    }

    task.messages.push(...messages)
    touchTaskSession(task)
}

export function appendTaskToolBatch(
    task: SubAgentTaskSession,
    steps: AgentStep[]
) {
    if (steps.length < 1) {
        return
    }

    appendTaskMessages(task, createAgentToolMessages(steps))
}

export function formatTaskResult(
    task: SubAgentTaskSession,
    run: SubAgentRunInfo,
    output: string
) {
    return [
        `task_id: ${task.id}`,
        `agent: ${task.agentName}`,
        `run_id: ${run.runId}`,
        `state: ${run.state}`,
        'resume_hint: call task again with the same agent and id to continue this session.',
        '',
        output.trim() || '(empty)'
    ].join('\n')
}

function createAgentToolMessages(steps: AgentStep[]): BaseMessage[] {
    return [
        new AIMessage({
            content: '',
            tool_calls: steps.map((step) => ({
                id: step.action.toolCallId,
                name: step.action.tool,
                args:
                    typeof step.action.toolInput !== 'string'
                        ? step.action.toolInput
                        : { input: step.action.toolInput }
            }))
        }),
        ...steps.map(
            (step) =>
                new ToolMessage({
                    content: step.observation,
                    tool_call_id: step.action.toolCallId,
                    name: step.action.tool
                })
        )
    ]
}

export function isHumanMessages(
    messages: BaseMessage[]
): messages is HumanMessage[] {
    return messages.every((message) => message.getType() === 'human')
}
