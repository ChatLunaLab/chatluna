import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { ChatLunaBaseEmbeddings, ChatLunaChatModel } from './model'
import { ChatLunaLLMChainWrapper } from '../chain/base'
import { StructuredTool, ToolRunnableConfig } from '@langchain/core/tools'
import { BaseMessage } from '@langchain/core/messages'
import { Context, Dict, Session } from 'koishi'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/model/base'
import { BasePlatformClient } from 'koishi-plugin-chatluna/llm-core/platform/client'

export interface ChatLunaChainInfo {
    name: string
    description?: Dict<string>
    createFunction: (
        params: CreateChatLunaLLMChainParams
    ) => Promise<ChatLunaLLMChainWrapper>
}

export interface CreateToolParams {
    /**
     * @deprecated This parameter is no passed to the function.
     * Please use the `metadata` in `parentConfig` parameter of {@link StructuredTool._call} to access `model`.
     */
    model?: never
    embeddings: ChatLunaBaseEmbeddings
    /**
     * @deprecated This parameter is no passed to the function.
     * Please use the `metadata` in `parentConfig` parameter of {@link StructuredTool._call} to access `conversationId`.
     */
    conversationId?: never
    /**
     * @deprecated This parameter is no passed to the function.
     * Please use the `metadata` in `parentConfig` parameter of {@link StructuredTool._call} to access `conversationId`.
     */
    preset?: never
    /**
     * @deprecated This parameter is no passed to the function.
     * Please use the `metadata` in `parentConfig` parameter of {@link StructuredTool._call} to access `userId`.
     */
    userId?: never
}

export interface CreateVectorStoreParams {
    key?: string
    embeddings: ChatLunaBaseEmbeddings
    //  topK?: number
}

export interface CreateChatLunaLLMChainParams {
    botName: string
    model: ChatLunaChatModel
    embeddings?: ChatLunaBaseEmbeddings
    historyMemory: BufferMemory
    preset: () => Promise<PresetTemplate>
    supportChatChain?: boolean
    vectorStoreName?: string
}

export interface ChatLunaTool {
    createTool: (params: CreateToolParams) => Promise<StructuredTool>
    selector: (history: BaseMessage[]) => boolean
    authorization?: (session: Session) => boolean
}

export type CreateVectorStoreFunction = (
    params: CreateVectorStoreParams
) => Promise<ChatLunaSaveableVectorStore>

export type CreateClientFunction = (ctx: Context) => BasePlatformClient

export interface PlatformClientName {
    default: never
}

export type PlatformClientNames = keyof PlatformClientName | string

export interface ModelInfo {
    name: string
    type: ModelType
    maxTokens: number
    capabilities: ModelCapabilities[]
}

export enum ModelCapabilities {
    ToolCall = 'tool_call',
    ImageInput = 'image_input',
    Thinking = 'thinking',
    ImageGeneration = 'image_generation'
}

export enum ModelType {
    all,
    llm,
    embeddings
}

export type ChatLunaToolRunnable = ToolRunnableConfig & {
    metadata: {
        model: ChatLunaChatModel
        session: Session
        conversationId?: string
        preset?: string
        userId?: string
    }
}
