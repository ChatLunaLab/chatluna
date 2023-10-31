import {
    BufferMemory,
    ConversationSummaryMemory,
    VectorStoreRetrieverMemory
} from 'langchain/memory'
import { ChatHubBaseEmbeddings, ChatHubChatModel } from './model'
import { ChatHubLLMChainWrapper, SystemPrompts } from '../chain/base'
import { VectorStore } from 'langchain/vectorstores/base'
import { Tool } from 'langchain/tools'
import { BaseMessage } from 'langchain/schema'

export interface ChatHubChainInfo {
    name: string
    description?: string
    createFunction: (
        params: CreateChatHubLLMChainParams
    ) => Promise<ChatHubLLMChainWrapper>
}

export interface CreateToolParams {
    model: ChatHubChatModel
    embeddings: ChatHubBaseEmbeddings
}

export interface CreateVectorStoreParams {
    key?: string
    embeddings: ChatHubBaseEmbeddings
    //  topK?: number
}

export interface CreateChatHubLLMChainParams {
    botName: string
    model: ChatHubChatModel
    embeddings?: ChatHubBaseEmbeddings
    longMemory?: VectorStoreRetrieverMemory
    historyMemory: ConversationSummaryMemory | BufferMemory
    systemPrompt?: SystemPrompts
    vectorStoreName?: string
}

export type CreateToolFunction = (params: CreateToolParams) => Promise<Tool>

export interface ChatHubTool {
    tool: Tool
    selector: (history: BaseMessage[]) => boolean
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

    supportChatMode?(mode: string): boolean
}

export enum ModelType {
    all,
    llm,
    embeddings
}
