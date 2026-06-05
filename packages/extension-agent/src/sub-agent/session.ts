/** @module sub-agent/session */

import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage
} from '@langchain/core/messages'
import {
    type AgentStep,
    observationToMessageContent
} from 'koishi-plugin-chatluna/llm-core/agent'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
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
    task.updatedAt = Date.now()
}

export function appendTaskMessages(
    task: SubAgentTaskSession,
    messages: BaseMessage[]
) {
    if (messages.length < 1) return
    task.messages.push(...messages)
    task.updatedAt = Date.now()
}

export function appendTaskToolBatch(
    task: SubAgentTaskSession,
    steps: AgentStep[]
) {
    if (steps.length < 1) return
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
        `resume_hint: use task with {"action":"run","id":"${task.id}","prompt":"next instruction"} ` +
            'to continue this session. Add "background":true when the work may take a while.',
        '',
        output.trim() || '(empty)'
    ].join('\n')
}

export function formatTaskStart(
    task: SubAgentTaskSession,
    run: SubAgentRunInfo
) {
    return [
        `task_id: ${task.id}`,
        `agent: ${task.agentName}`,
        `run_id: ${run.runId}`,
        'state: running',
        'mode: background',
        `status_hint: use task with {"action":"status","id":"${task.id}"} to inspect progress.`,
        'list_hint: use task with {"action":"list"} to see recent sub-agent tasks in this conversation.',
        `message_hint: use task with {"action":"message","id":"${task.id}","message":"..."} to send more guidance while it runs.`,
        `resume_hint: after it stops, use task with {"action":"run","id":"${task.id}","prompt":"next instruction"} to continue this session.`
    ].join('\n')
}

export function formatTaskList(
    tasks: SubAgentTaskSession[],
    getRun: (taskId: string) => SubAgentRunInfo | undefined
) {
    return [
        'Sub-agent tasks:',
        ...tasks.map((task) => {
            const run = getRun(task.id)
            return [
                task.id,
                `[${run?.state ?? (task.activeRunId ? 'running' : 'idle')}]`,
                task.agentName,
                `mode=${run?.background ? 'background' : 'foreground'}`,
                `updated=${new Date(task.updatedAt).toISOString()}`,
                `run=${run?.runId ?? task.activeRunId ?? '-'}`
            ].join(' ')
        }),
        '',
        'Use task with {"action":"status","id":"..."} to inspect one task.'
    ].join('\n')
}

export function formatTaskDetail(
    task: SubAgentTaskSession,
    run?: SubAgentRunInfo
) {
    const lines = [
        `task_id: ${task.id}`,
        `agent: ${task.agentName}`,
        `state: ${run?.state ?? (task.activeRunId ? 'running' : 'idle')}`,
        `mode: ${run?.background ? 'background' : 'foreground'}`,
        `run_id: ${run?.runId ?? task.activeRunId ?? '-'}`,
        `depth: ${task.depth}`,
        `parent_agent: ${task.parentAgent}`,
        `started: ${new Date(task.startedAt).toISOString()}`,
        `updated: ${new Date(task.updatedAt).toISOString()}`
    ]

    if (run?.lastTool) {
        lines.push(`last_tool: ${run.lastTool}`)
    }

    if (run) {
        lines.push(`tool_count: ${run.toolCount}`)
        lines.push(`turn_count: ${run.turnCount}`)
    }

    if (run?.endedAt) {
        lines.push(`ended: ${new Date(run.endedAt).toISOString()}`)
    }

    if (run?.error) {
        lines.push(`error: ${run.error}`)
    }

    lines.push(
        `status_hint: use task with {"action":"status","id":"${task.id}"} to inspect it again.`
    )

    if (run?.state === 'running' && run.background) {
        lines.push(
            `message_hint: use task with {"action":"message","id":"${task.id}","message":"..."} to send more guidance while it runs.`
        )
    }

    if (run?.state !== 'running') {
        lines.push(
            `resume_hint: use task with {"action":"run","id":"${task.id}","prompt":"next instruction"} ` +
                'to continue this session. Add "background":true when the work may take a while.'
        )
    }

    lines.push('')

    if (run?.output?.trim()) {
        lines.push('Output:')
        lines.push(run.output.trim())
        return lines.join('\n')
    }

    lines.push('History:')
    lines.push(formatTaskHistory(task.messages))
    return lines.join('\n')
}

function createAgentToolMessages(steps: AgentStep[]): BaseMessage[] {
    const message = steps[0]?.action.messageLog?.[0]

    return [
        new AIMessage({
            content: '',
            additional_kwargs: message?.additional_kwargs ?? {},
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
                    content: observationToMessageContent(step.observation),
                    tool_call_id: step.action.toolCallId,
                    name: step.action.tool
                })
        )
    ]
}

function formatTaskHistory(messages: BaseMessage[]) {
    const lines = messages
        .map((msg) => {
            const text = getMessageContent(msg.content)
                .replace(/\s+/g, ' ')
                .trim()
            if (!text) return undefined
            return `${msg.getType()}: ${text.length > 280 ? `${text.slice(0, 277)}...` : text}`
        })
        .filter((item): item is string => item != null)

    if (lines.length < 1) return '(no messages yet)'
    return lines.slice(-6).join('\n')
}

export function isHumanMessages(
    messages: BaseMessage[]
): messages is HumanMessage[] {
    return messages.every((msg) => msg.getType() === 'human')
}
