/** @module sub-agent/runtime */

import {
    AgentRunContext,
    MessageQueue
} from 'koishi-plugin-chatluna/llm-core/agent'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { Session } from 'koishi'
import { SubAgentInfo } from '../types'
import { SubAgentTaskSession } from './session'

export interface RunSubAgentOptions {
    agentId: string
    prompt: string
    session: Session
    parentConversationId: string
    parentContext?: AgentRunContext
    signal?: AbortSignal
    model?: ChatLunaChatModel
    task?: SubAgentTaskSession
    background?: boolean
}

export interface ActiveSubAgentRun {
    abort: AbortController
    queue: MessageQueue
}

export function isRunnable(info: SubAgentInfo) {
    return (
        info.enabled &&
        info.state === 'ready' &&
        !info.hidden &&
        !info.shadowedBy
    )
}

export function clearDisposers(store: Map<string, () => void>) {
    for (const fn of store.values()) fn()
    store.clear()
}
