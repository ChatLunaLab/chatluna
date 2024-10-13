import { BufferMemory, ConversationSummaryMemory } from 'langchain/memory'
import { ChatHubBaseEmbeddings, ChatLunaChatModel } from './model'
import { ChatHubLLMChainWrapper } from '../chain/base'
import { VectorStore } from '@langchain/core/vectorstores'
import { StructuredTool } from '@langchain/core/tools'
import { BaseMessage } from '@langchain/core/messages'
import { Dict, Session } from 'koishi'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
export interface ChatHubChainInfo {
    name: string
    description?: Dict<string>
    createFunction: (
        params: CreateChatHubLLMChainParams
    ) => Promise<ChatHubLLMChainWrapper>
}

export interface CreateToolParams {
    model: ChatLunaChatModel
    embeddings: ChatHubBaseEmbeddings
    conversationId?: string
    preset?: string
    userId?: string
}

export interface CreateVectorStoreParams {
    key?: string
    embeddings: ChatHubBaseEmbeddings
    //  topK?: number
}

export interface CreateChatHubLLMChainParams {
    botName: string
    model: ChatLunaChatModel
    embeddings?: ChatHubBaseEmbeddings
    historyMemory: ConversationSummaryMemory | BufferMemory
    preset: () => Promise<PresetTemplate>
    vectorStoreName?: string
}

export interface ChatHubTool {
    createTool: (
        params: CreateToolParams,
        session?: Session
    ) => Promise<StructuredTool>
    selector: (history: BaseMessage[]) => boolean
    authorization?: (session: Session) => boolean
    alwaysRecreate?: boolean
}

export type CreateVectorStoreFunction = (
    params: CreateVectorStoreParams
) => Promise<VectorStore>

export interface PlatformClientName {
    default: never
}

export type PlatformClientNames = keyof PlatformClientName | string

export interface ModelInfo {
    name: string

    type: ModelType

    maxTokens?: number

    functionCall?: boolean

    supportMode?: string[]
}

export enum ModelType {
    all,
    llm,
    embeddings
}
