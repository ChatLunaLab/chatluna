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
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables?: Record<string, any>
}

export interface EmbeddingsRequestParams extends BaseRequestParams {
    input: string | string[]
}

export interface BaseRequester {
    init(): Promise<void>

    dispose(): Promise<void>

    logger: Logger
}

export abstract class ModelRequester<
    T extends ClientConfig = ClientConfig,
    R extends ChatLunaPlugin.Config = ChatLunaPlugin.Config
> implements BaseRequester
{
    private _errorCounts: Record<string, number> = {}

    abstract logger: Logger

    constructor(
        protected ctx: Context,
        protected _configPool: ClientConfigPool<T>,
        protected _pluginConfig: R,
        protected _plugin: ChatLunaPlugin
    ) {}

    async completion(params: ModelRequestParams): Promise<ChatGeneration> {
        const stream = this.completionStream(params)

        // get final result
        let result: ChatGenerationChunk

        for await (const chunk of stream) {
            result = result != null ? result.concat(chunk) : chunk
        }

        return result
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        // refresh config
        this._configPool.getConfig(false)
        const config = this._config
        try {
            for await (const chunk of this.completionStreamInternal(params)) {
                yield chunk
            }
        } catch (e) {
            if (
                (e instanceof ChatLunaError &&
                    (e.errorCode === ChatLunaErrorCode.NETWORK_ERROR ||
                        e.errorCode === ChatLunaErrorCode.API_REQUEST_TIMEOUT ||
                        e.errorCode === ChatLunaErrorCode.ABORTED ||
                        e.errorCode ===
                            ChatLunaErrorCode.API_UNSAFE_CONTENT)) ||
                e.name === 'AbortError'
            ) {
                // Ignore network errors
                throw e
            }

            this._errorCounts[config.md5()] =
                (this._errorCounts[config.md5()] || 0) + 1

            if (
                this._errorCounts[config.md5()] > this._pluginConfig.maxRetries
            ) {
                this._configPool.markConfigStatus(config.value, false)
                delete this._errorCounts[config.md5()]
            }

            throw e
        }
    }

    protected abstract completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk>

    async init(): Promise<void> {}

    async dispose(model?: string, id?: string): Promise<void> {}

    public post(
        url: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: any,
        params: fetchType.RequestInit = {}
    ) {
        const requestUrl = this.concatUrl(url)

        for (const key in data) {
            if (data[key] === undefined) {
                delete data[key]
            }
        }

        const body = JSON.stringify(data)

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { headers: initHeaders, method: _m, ...rest } = params
        return this._plugin.fetch(requestUrl, {
            ...rest,
            method: 'POST',
            headers: {
                ...this.buildHeaders(),
                ...(initHeaders as Record<string, string> | undefined)
            },
            body
        })
    }

    public get(
        url: string,
        headers?: Record<string, string>,
        params: fetchType.RequestInit = {}
    ) {
        const requestUrl = this.concatUrl(url)

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { headers: initHeaders, method: _m, ...rest } = params
        return this._plugin.fetch(requestUrl, {
            ...rest,
            method: 'GET',
            headers: {
                ...this.buildHeaders(),
                ...(initHeaders as Record<string, string> | undefined),
                ...headers
            }
        })
    }

    protected get _config() {
        return this._configPool.getConfig(true)
    }

    public buildHeaders(): Record<string, string> {
        return {
            Authorization: `Bearer ${this._config.value.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/ChatLunaLab/chatluna', // Optional. Site URL for rankings on openrouter.ai.
            'X-Title': 'ChatLuna' // Optional. Site title for rankings on openrouter.ai.
        }
    }

    public concatUrl(url: string): string {
        const apiEndPoint = this._config.value.apiEndpoint

        // match the apiEndPoint ends with '/v1' or '/v1/' using regex
        if (!apiEndPoint.match(/\/v1\/?$/)) {
            if (apiEndPoint.endsWith('/')) {
                return apiEndPoint + 'v1/' + url
            }

            return apiEndPoint + '/v1/' + url
        }

        if (apiEndPoint.endsWith('/')) {
            return apiEndPoint + url
        }

        return apiEndPoint + '/' + url
    }
}

export interface EmbeddingsRequester {
    embeddings(params: EmbeddingsRequestParams): Promise<number[] | number[][]>
}
