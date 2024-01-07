import {
    BufferMemory,
    ConversationSummaryMemory,
    VectorStoreRetrieverMemory
} from 'langchain/memory'
import { ChatHubBaseEmbeddings, ChatLunaChatModel } from './model'
import { ChatHubLLMChainWrapper, SystemPrompts } from '../chain/base'
import { VectorStore } from '@langchain/core/vectorstores'
import { StructuredTool } from '@langchain/core/tools'
import { BaseMessage } from '@langchain/core/messages'
import { Session } from 'koishi'

export interface ChatHubChainInfo {
    name: string
    description?: string
    createFunction: (
        params: CreateChatHubLLMChainParams
    ) => Promise<ChatHubLLMChainWrapper>
}

export interface CreateToolParams {
    model: ChatLunaChatModel
    embeddings: ChatHubBaseEmbeddings
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
    longMemory?: VectorStoreRetrieverMemory
    historyMemory: ConversationSummaryMemory | BufferMemory
    systemPrompt?: SystemPrompts
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
