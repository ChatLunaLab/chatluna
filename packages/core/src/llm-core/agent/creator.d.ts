import { ComputedRef } from '@vue/reactivity'
import type { ChatLunaChatModel } from '../platform/model'
import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaChatPrompt } from '../chain/prompt'
import { AgentExecutor } from './executor'
import { ChatLunaTool } from '../platform/types'
import { BaseMessage } from '@langchain/core/messages'
import { Session } from 'koishi'
import { ChatLunaBaseEmbeddings } from '../platform/model'
export interface CreateAgentExecutorOptions {
    llm: ComputedRef<ChatLunaChatModel>
    tools: ComputedRef<StructuredTool[]>
    prompt: ChatLunaChatPrompt
    agentMode: 'react' | 'tool-calling'
    returnIntermediateSteps?: boolean
    handleParsingErrors?: boolean
    instructions?: ComputedRef<string>
}
export declare function createAgentExecutor(
    options: CreateAgentExecutorOptions
): ComputedRef<AgentExecutor>
export interface CreateToolsRefOptions {
    tools: ComputedRef<ChatLunaTool[]>
    embeddings: ChatLunaBaseEmbeddings
}
export declare function createToolsRef(options: CreateToolsRefOptions): {
    update: (session: Session, messages: BaseMessage[]) => boolean
    tools: ComputedRef<
        StructuredTool<
            import('@langchain/core/tools').ToolSchemaBase,
            any,
            any,
            any
        >[]
    >
}
