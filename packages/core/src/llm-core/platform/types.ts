import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { ChatLunaBaseEmbeddings, ChatLunaChatModel } from './model'
import { ChatLunaLLMChainWrapper } from '../chain/base'
import { StructuredTool, ToolRunnableConfig } from '@langchain/core/tools'
import { BaseMessage, type UsageMetadata } from '@langchain/core/messages'
import { Dict, Session } from 'koishi'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { BasePlatformClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ComputedRef } from '@vue/reactivity'
import { AgentRunContext } from '../agent'

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
    description?: string
    name?: string
    id?: string
    meta?: ChatLunaToolMeta
}

export type ChatLunaToolCharacterScope = 'all' | 'group' | 'private' | 'none'

export interface ChatLunaToolDefaultAvailability {
    enabled?: boolean
    main?: boolean
    subAgent?: boolean
    chatluna?: boolean
    characterScope?: ChatLunaToolCharacterScope
}

export interface ChatLunaToolMeta {
    source?:
        | 'core'
        | 'extension'
        | 'mcp'
        | 'action'
        | (string & Record<never, never>)
    group?: string
    tags?: string[]
    isMcp?: boolean
    serverName?: string
    defaultAvailability?: ChatLunaToolDefaultAvailability
    /** @deprecated use defaultAvailability */
    defaultEnabled?: boolean
    /** @deprecated use defaultAvailability */
    defaultMain?: boolean
    /** @deprecated use defaultAvailability */
    defaultChatluna?: boolean
    /** @deprecated use defaultAvailability */
    defaultCharacter?: boolean
    /** @deprecated use defaultAvailability */
    defaultCharacterGroup?: boolean
    /** @deprecated use defaultAvailability */
    defaultCharacterPrivate?: boolean
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
    TextInput = 'text_input',
    ToolCall = 'tool_call',
    ImageInput = 'image_input',
    Thinking = 'thinking',
    ImageGeneration = 'image_generation',
    AudioInput = 'audio_input',
    VideoInput = 'video_input',
    FileInput = 'file_input'
}

export enum ModelType {
    all,
    llm,
    embeddings,
    reranker
}

export type ChatLunaToolRunnable = ToolRunnableConfig & {
    configurable: {
        model: ChatLunaChatModel
        session: Session
        preset?: string
        agentContext?: AgentRunContext
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

export type TokenUsageTracker = UsageMetadata

/**
 * Describes how a platform handles file uploads (inline data, size limits, etc.).
 * Platforms that support multimodal file input should override
 * {@link BasePlatformClient.getFileHandlingConfig} and return this.
 */
export interface FileHandlingConfig {
    /** Set of MIME types the platform can accept as inline data. */
    supportedMimeTypes: Set<string>

    /** Maximum total inline data size (in bytes) per message. */
    maxTotalSizeBytes: number

    /** Default maximum size (in bytes) for a single inline file. */
    maxFileSizeBytes: number

    /**
     * Per-MIME-type size overrides.
     * For example, `{ 'application/pdf': 50 * 1024 * 1024 }`.
     */
    maxFileSizeBytesOverrides?: Record<string, number>
}
