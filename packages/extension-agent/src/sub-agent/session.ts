/** @module sub-agent/session */

import type { BaseMessage } from '@langchain/core/messages'

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
