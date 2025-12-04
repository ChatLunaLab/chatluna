import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager'
import { Embeddings, EmbeddingsParams } from '@langchain/core/embeddings'
import {
    BaseChatModel,
    BaseChatModelCallOptions
} from '@langchain/core/language_models/chat_models'
import { BaseMessage } from '@langchain/core/messages'
import { ChatGenerationChunk, ChatResult } from '@langchain/core/outputs'
import { StructuredTool } from '@langchain/core/tools'
import { Tiktoken } from 'js-tiktoken'
import {
    EmbeddingsRequester,
    ModelRequester
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { ModelInfo } from 'koishi-plugin-chatluna/llm-core/platform/types'
export interface ChatLunaModelCallOptions extends BaseChatModelCallOptions {
    model?: string
    /** Sampling temperature to use */
    temperature?: number
    /**
     * Maximum number of tokens to generate in the completion. -1 returns as many
     * tokens as possible given the prompt and the model's maximum context size.
     */
    maxTokens?: number
    /**
     * Maximum number of tokens to crop the context to.
     * If not set, the model's maximum context size will be used.
     */
    maxTokenLimit?: number
    /** Total probability mass of tokens to consider at each step */
    topP?: number
    /** Penalizes repeated tokens according to frequency */
    frequencyPenalty?: number
    /** Penalizes repeated tokens */
    presencePenalty?: number
    /** Number of completions to generate for each prompt */
    n?: number
    /** Dictionary used to adjust the probability of specific tokens being generated */
    logitBias?: Record<string, number>
    id?: string
    stream?: boolean
    tools?: StructuredTool[]
    tool_choice?: string
    variables?: Record<string, any>
    variables_hide?: Record<string, any>
}
export interface ChatLunaModelInput extends ChatLunaModelCallOptions {
    llmType?: string
    modelMaxContextSize?: number
    modelInfo: ModelInfo
    requester: ModelRequester
    maxConcurrency?: number
    maxRetries?: number
    isThinkModel?: boolean
}
export declare class ChatLunaChatModel extends BaseChatModel<ChatLunaModelCallOptions> {
    private _options
    protected __encoding: Tiktoken
    private _requester
    private _modelName
    private _maxModelContextSize
    private _modelInfo
    private _isThinkModel
    lc_serializable: boolean
    constructor(_options: ChatLunaModelInput)
    get callKeys(): (keyof ChatLunaModelCallOptions)[]
    /**
     * Get the parameters used to invoke the model
     */
    invocationParams(
        options?: this['ParsedCallOptions']
    ): ChatLunaModelCallOptions

    _streamResponseChunks(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun
    ): AsyncGenerator<ChatGenerationChunk>

    private _createTokenUsageTracker
    private _handleStreamChunk
    private _isToolCallMessage
    private _updateTokenUsageFromChunk
    private _ensureChunksReceived
    private _finalizeStream
    private _closeStream
    private _shouldRethrowStreamError
    private _isAbortError
    _generate(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun
    ): Promise<ChatResult>

    private _generateWithRetry
    private _withTimeout
    /**
     ** Creates a streaming request with retry.
     * @param request The parameters for creating a completion.
     ** @returns A streaming request.
     */
    private _createStreamWithRetry
    /** @ignore */
    private _completion
    cropMessages(
        messages: BaseMessage[],
        tools?: StructuredTool[],
        systemMessageLength?: number
    ): Promise<[BaseMessage[], number]>

    countMessageTokens(message: BaseMessage): Promise<number>
    clearContext(id: string): Promise<void>
    getModelMaxContextSize(modelName?: string): number
    getNumTokens(text: string, modelName?: string): Promise<number>
    _llmType(): string
    get modelName(): string
    get modelInfo(): ModelInfo
    get isThinkModel(): boolean
    _modelType(): string
    /** @ignore */
    _combineLLMOutput(...llmOutputs: any[]): any
}
export interface ChatLunaBaseEmbeddingsParams extends EmbeddingsParams {
    /**
     * Timeout to use when making requests.
     */
    timeout?: number
    /**
     * The maximum number of documents to embed in a single request. This is
     * limited by the OpenAI API to a maximum of 2048.
     */
    batchSize?: number
    /**
     * Whether to strip new lines from the input text. This is recommended by
     * OpenAI, but may not be suitable for all use cases.
     */
    stripNewLines?: boolean
    maxRetries?: number
    client: EmbeddingsRequester
    model?: string
}
export declare abstract class ChatLunaBaseEmbeddings extends Embeddings {}
export declare class ChatLunaEmbeddings extends ChatLunaBaseEmbeddings {
    modelName: string
    batchSize: number
    stripNewLines: boolean
    timeout?: number
    private _client
    constructor(fields?: ChatLunaBaseEmbeddingsParams)
    embedDocuments(texts: string[]): Promise<number[][]>
    embedQuery(text: string): Promise<number[]>
    private _embeddingWithRetry
}
