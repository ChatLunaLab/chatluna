import { BaseMessage } from '@langchain/core/messages'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import type { AgentTaskRun, AgentTaskSession } from './types'

export function escapeXml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

export function formatTraceText(value: unknown): string {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
        const text = value
            .map((item) =>
                typeof item === 'object' &&
                item != null &&
                'text' in item &&
                typeof item.text === 'string'
                    ? item.text
                    : JSON.stringify(item, null, 2)
            )
            .join('\n\n')
        if (text) return text
    }
    return JSON.stringify(value, null, 2) ?? String(value)
}

export function formatTaskHistory(messages: BaseMessage[]) {
    const lines = messages
        .map((msg) => {
            const text = getMessageContent(msg.content)
                .replace(/\s+/g, ' ')
                .trim()
            return text
                ? `${msg.getType()}: ${text.length > 140 ? `${text.slice(0, 137)}...` : text}`
                : undefined
        })
        .filter((item): item is string => item != null)
    return lines.length < 1 ? '(no messages yet)' : lines.slice(-3).join('\n')
}

export function getLatestTaskRun(
    runs: Map<string, AgentTaskRun>,
    taskId: string
) {
    let latest: AgentTaskRun | undefined
    for (const run of runs.values()) {
        if (run.taskId !== taskId) continue
        if (!latest || run.startedAt > latest.startedAt) latest = run
    }
    return latest
}

export function formatTaskResult(
    task: AgentTaskSession,
    run: AgentTaskRun,
    output: string,
    toolName: string
) {
    return [
        output.trim() || '(empty)',
        '',
        `task_id: ${task.id}`,
        `agent: ${task.agentName}`,
        `state: ${run.state}`,
        `hint: use ${toolName} action=run id=${task.id} to continue`
    ].join('\n')
}

export function formatTaskStart(task: AgentTaskSession, toolName: string) {
    return [
        `task_id: ${task.id}`,
        `agent: ${task.agentName}`,
        'state: running (background)',
        'hint: result will be delivered automatically - do NOT poll status. ' +
            `Continue other work or end your reply; use ${toolName} ` +
            `action=message id=${task.id} to send guidance.`
    ].join('\n')
}

export function formatAgentTaskWakeup(
    taskId: string,
    agentName: string,
    run: Pick<AgentTaskRun, 'state' | 'output' | 'error'>
) {
    return [
        `<agent_task_result task_id="${escapeXml(taskId)}" agent="${escapeXml(agentName)}" state="${run.state}">`,
        escapeXml(
            run.state === 'failed' ? (run.error ?? '') : (run.output ?? '')
        ),
        '</agent_task_result>',
        '',
        run.state === 'failed'
            ? 'Automatic notice: a background task you started failed. ' +
              `Report the failure or retry with task action=run id=${taskId}.`
            : 'Automatic notice: a background task you started finished. ' +
              'Use the result to respond to the user; continue it with ' +
              `task action=run id=${taskId} if needed.`
    ].join('\n')
}

export function formatTaskList(
    tasks: AgentTaskSession[],
    getRun: (taskId: string) => AgentTaskRun | undefined,
    toolName: string,
    all?: boolean
) {
    return [
        all ? 'Agent tasks (all):' : 'Agent tasks:',
        ...tasks.map((t) => {
            const run = getRun(t.id)
            return [
                t.id,
                `[${run?.state ?? (t.activeRunId ? 'running' : 'idle')}]`,
                t.agentName,
                `mode=${run?.background ? 'background' : 'foreground'}`,
                `parent=${t.parentConversationId}`
            ].join(' ')
        }),
        '',
        `Use ${toolName} action=status id=... or action=stop id=...`
    ].join('\n')
}

export function formatTaskDetail(
    task: AgentTaskSession,
    run: AgentTaskRun | undefined,
    toolName: string
) {
    const meta = [
        `task_id: ${task.id}`,
        `agent: ${task.agentName}`,
        `state: ${run?.state ?? (task.activeRunId ? 'running' : 'idle')}`,
        `mode: ${run?.background ? 'background' : 'foreground'}`
    ]
    if (run?.error) meta.push(`error: ${run.error}`)
    meta.push(
        run?.state === 'running' && run.background
            ? `hint: use ${toolName} action=message id=${task.id}`
            : `hint: use ${toolName} action=run id=${task.id} to continue`
    )
    if (run?.output?.trim()) return [run.output.trim(), '', ...meta].join('\n')
    return ['History:', formatTaskHistory(task.messages), '', ...meta].join(
        '\n'
    )
}
