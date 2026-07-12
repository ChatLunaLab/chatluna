import type {
    TriggerConversationPolicy,
    TriggerTaskState
} from '../types/trigger'

export function gateCursor(
    cursor: TriggerTaskState['cursor']
): Record<string, unknown> | null {
    if (cursor == null || typeof cursor !== 'object') return null
    if (!('gate' in cursor)) return null
    return { gate: cursor.gate }
}

export function toInvokeConversation(
    policy: TriggerConversationPolicy,
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
