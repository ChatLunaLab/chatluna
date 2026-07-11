import type { TriggerTask, TriggerTaskState } from '../types/trigger'

export function keepGateCursor(
    cursor: TriggerTaskState['cursor']
): Record<string, unknown> | null {
    if (cursor == null || typeof cursor !== 'object') return null
    if (!('gate' in cursor)) return null
    return { gate: cursor.gate }
}

export function toInvokeConversation(
    policy: TriggerTask['execution']['conversation'],
    taskKey: string
) {
    if (policy.type === 'existing') {
        return { type: 'existing' as const, id: policy.conversationId }
    }
    if (policy.type === 'task') {
        return { type: 'task' as const, key: taskKey }
    }
    return policy
}
