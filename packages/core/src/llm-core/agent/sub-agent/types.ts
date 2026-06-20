import type { BaseMessage } from '@langchain/core/messages'
import type { StructuredTool } from '@langchain/core/tools'
import type { Awaitable, Session } from 'koishi'
import type { ChatLunaAgent } from '../agent'
import type { ChatLunaToolRunnable } from '../../platform/types'
import type { MessageQueue, SubagentContext, ToolMask } from '../types'

export interface AgentTaskDescriptor {
    id: string
    name: string
    description: string
}

export interface AgentTaskTarget {
    agent: ChatLunaAgent
    toolMask?: ToolMask
}

export interface AgentTaskSession {
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

export interface AgentTaskRunTraceEntry {
    id: string
    type:
        | 'prompt'
        | 'message'
        | 'thought'
        | 'tool-call'
        | 'tool-result'
        | 'output'
        | 'error'
    at: number
    text: string
    tool?: string
    title?: string
    callId?: string
}

export interface AgentTaskRun {
    runId: string
    taskId: string
    agentId: string
    agentName: string
    conversationId: string
    parentConversationId: string
    depth: number
    state: 'running' | 'completed' | 'failed' | 'aborted'
    background?: boolean
    paused?: boolean
    startedAt: number
    endedAt?: number
    lastTool?: string
    toolCount: number
    turnCount: number
    error?: string
    output?: string
    trace: AgentTaskRunTraceEntry[]
}

export interface AgentTaskSessionSnapshot {
    session?: Session
    routing?: {
        platform: string
        selfId: string
        userId: string
        username?: string
        guildId?: string
        channelId?: string
        isDirect: boolean
    }
    bindingKey?: string
}

export interface AgentTaskFinishedPayload {
    run: AgentTaskRun
    taskId: string
    agentId: string
    agentName: string
    parentConversationId: string
    source: 'chatluna' | 'character'
    snapshot?: AgentTaskSessionSnapshot
}

export interface AgentTaskInput {
    action?: 'run' | 'status' | 'list' | 'list_all' | 'message' | 'stop'
    agent?: string
    id?: string
    prompt?: string
    reason?: string
    background?: boolean
    message?: string
    goal?: string
}

export interface AgentTaskQueryContext {
    session?: Session
    source?: 'chatluna' | 'character'
}

export interface AgentTaskResolveContext extends AgentTaskQueryContext {
    conversationId?: string
    parent?: SubagentContext
    runConfig?: ChatLunaToolRunnable
}

export interface CreateTaskToolOptions {
    list: (ctx: AgentTaskQueryContext) => Awaitable<AgentTaskDescriptor[]>
    get: (
        name: string,
        ctx: AgentTaskResolveContext
    ) => Awaitable<AgentTaskTarget | undefined>
    refresh?: () => Awaitable<void>
    maxDepth?: number
    taskTtl?: number
    runTtl?: number
    name?: string
    onRunFinished?: (payload: AgentTaskFinishedPayload) => Awaitable<void>
}

export interface AgentTaskToolRuntime {
    buildToolDescription(): string
    createTool(): StructuredTool
    dispose(): Promise<void>
    getRuns(): AgentTaskRun[]
    getTasks(): AgentTaskSession[]
    getTask(id: string): AgentTaskSession | undefined
    stopTask(id: string): Promise<boolean>
    pauseTask(id: string): Promise<boolean>
    resumeTask(id: string): Promise<boolean>
    abortByParentConversation(id: string): Promise<number>
    chatTask(
        id: string,
        prompt: string,
        ctx: AgentTaskResolveContext
    ): Promise<{ state: 'queued' | AgentTaskRun['state']; output?: string }>
    runTask(
        input: AgentTaskInput,
        runConfig?: ChatLunaToolRunnable
    ): Promise<string>
}

interface ActiveAgentTaskRun {
    abort: AbortController
    queue: MessageQueue
    paused?: boolean
    resume?: () => void
}

export type { ActiveAgentTaskRun }

declare module 'koishi' {
    interface Events {
        'chatluna/agent-task-finished': (
            payload: AgentTaskFinishedPayload
        ) => Promise<void>
    }
}
