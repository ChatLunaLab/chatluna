import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { ChatLunaBaseEmbeddings, ChatLunaChatModel } from './model'
import { ChatLunaLLMChainWrapper } from '../chain/base'
import { StructuredTool, ToolRunnableConfig } from '@langchain/core/tools'
import { BaseMessage } from '@langchain/core/messages'
import { Dict, Session } from 'koishi'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { BasePlatformClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ComputedRef } from '@vue/reactivity'

export interface ChatLunaChainInfo {
    name: string
    description?: Dict<string>
    createFunction: (
        params: CreateChatLunaLLMChainParams
    ) => ChatLunaLLMChainWrapper
}

export interface CreateToolParams {
    /**
     * @deprecated This parameter is no passed to the function.
     * Please use the `configurable` in `parentConfig` parameter of {@link StructuredTool._call} to access `model`.
     */
    model?: never

    /**
     * @deprecated This parameter is no passed to the function.
     * Please use the `configurable` in `parentConfig` parameter of {@link StructuredTool._call} to access `conversationId`.
     */
    conversationId?: never
    /**
     * @deprecated This parameter is no passed to the function.
     * Please use the `configurable` in `parentConfig` parameter of {@link StructuredTool._call} to access `preset`.
     */
    preset?: never
    /**
     * @deprecated This parameter is no passed to the function.
     * Please use the `configurable` in `parentConfig` parameter of {@link StructuredTool._call} to access `userId`.
     */
    userId?: never

    embeddings: ChatLunaBaseEmbeddings
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
    preset: ComputedRef<PresetTemplate>
    supportChatChain?: boolean
    vectorStoreName?: string
}

export interface ChatLunaTool {
    createTool: (params: CreateToolParams) => StructuredTool
    selector: (history: BaseMessage[]) => boolean
    authorization?: (session: Session) => boolean
    name?: string
    id?: string
}

export type CreateVectorStoreFunction = (
    params: CreateVectorStoreParams
) => Promise<ChatLunaSaveableVectorStore>

export type CreateClientFunction = () => BasePlatformClient

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

export interface PlatformModelInfo extends ModelInfo {
    platform: PlatformClientNames
    toModelName: () => string
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
    configurable: {
        model: ChatLunaChatModel
        session: Session
        conversationId?: string
        preset?: string
        userId?: string
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isModelInfo(model: any): model is ModelInfo {
    return model.name != null && model.type != null && model.maxTokens != null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPlatformModelInfo(model: any): model is PlatformModelInfo {
    return (
        isModelInfo(model) &&
        model['platform'] != null &&
        model['platform'] !== 'default'
    )
}

export type TokenUsageTracker = {
    promptTokens: number
    completionTokens: number
    totalTokens: number
}
