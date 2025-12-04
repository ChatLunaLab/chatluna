import { BaseMessage } from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { ChatGeneration, ChatGenerationChunk } from '@langchain/core/outputs'
import {
    ClientConfig,
    ClientConfigPool
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import { Context, Logger } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import * as fetchType from 'undici/types/fetch'
export interface BaseRequestParams {
    /**
     * Timeout to use when making requests to OpenAI.
     */
    timeout?: number
    /**
     ** The signal to use for cancellation.
     **/
    signal?: AbortSignal
    /** Model name to use */
    model?: string
}
export interface ModelRequestParams extends BaseRequestParams {
    /** Sampling temperature to use */
    temperature?: number
    /**
     * Maximum number of tokens to generate in the completion. -1 returns as many
     * tokens as possible given the prompt and the model's maximum context size.
     */
    maxTokens?: number
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
    /** Unique string identifier representing your end-user, which can help OpenAI to monitor and detect abuse. */
    user?: string
    /** List of stop words to use when generating */
    stop?: string[] | string
    /**
     * Input messages to use for model completion.
     */
    input: BaseMessage[]
    id?: string
    tools?: StructuredTool[]
    variables?: Record<string, any>
    /**
     * Override request params for this request only.
     */
    overrideRequestParams?: Record<string, any>
}
export interface EmbeddingsRequestParams extends BaseRequestParams {
    input: string | string[]
}
export interface BaseRequester {
    init(): Promise<void>
    dispose(): Promise<void>
    logger: Logger
}
export declare abstract class ModelRequester<
    T extends ClientConfig = ClientConfig,
    R extends ChatLunaPlugin.Config = ChatLunaPlugin.Config
> implements BaseRequester {
    protected ctx: Context
    protected _configPool: ClientConfigPool<T>
    protected _pluginConfig: R
    protected _plugin: ChatLunaPlugin<T, R>
    private _errorCounts
    abstract logger: Logger
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<T>,
        _pluginConfig: R,
        _plugin: ChatLunaPlugin<T, R>
    )

    completion(params: ModelRequestParams): Promise<ChatGeneration>
    completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk>

    protected abstract completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk>

    init(): Promise<void>
    dispose(model?: string, id?: string): Promise<void>
    post(
        url: string,
        data: any,
        params?: fetchType.RequestInit
    ): Promise<fetchType.Response>

    get(
        url: string,
        headers?: Record<string, string>,
        params?: fetchType.RequestInit
    ): Promise<fetchType.Response>

    protected get _config(): import('koishi-plugin-chatluna/llm-core/platform/config').ClientConfigWrapper<T>
    buildHeaders(): Record<string, string>
    concatUrl(url: string): string
}
export interface EmbeddingsRequester {
    embeddings(params: EmbeddingsRequestParams): Promise<number[] | number[][]>
}
