import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    buildChatCompletionParams,
    createRequestContext,
    processStreamResponse
} from '@chatluna/v1-shared-adapter'
import { Context, Logger } from 'koishi'
import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    ClientConfigPool,
    ClientConfigWrapper
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { deepAssign } from 'koishi-plugin-chatluna/utils/object'
import { SSEEvent, sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import * as fetchType from 'undici/types/fetch'
import { Config } from '.'
import {
    ChatCompletionRequest,
    ChatCompletionResponse,
    SparkClientConfig
} from './types'
import {
    getSparkModelDefinition,
    getSparkModelPassword,
    langchainMessageToSparkMessage
} from './utils'

let logger: Logger

export class SparkRequester extends ModelRequester<SparkClientConfig, Config> {
    private _modelConfigCursor: Record<string, number> = {}

    private _requestConfig?: ClientConfigWrapper<SparkClientConfig>

    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<SparkClientConfig>,
        public _pluginConfig: Config,
        _plugin: ChatLunaPlugin<SparkClientConfig, Config>
    ) {
        super(ctx, _configPool, _pluginConfig, _plugin)
        logger = createLogger(ctx, 'chatluna-spark-adapter')
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        await this.init()
        this._requestConfig = this._selectConfigForModel(params.model)

        const def = this._getModelDefinition(params.model)
        const requestContext = createRequestContext(
            this.ctx,
            this._requestConfig.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        try {
            const baseRequest = await buildChatCompletionParams(
                {
                    ...params,
                    model: def.httpModel
                },
                this._plugin,
                false,
                false
            )

            const request = deepAssign(
                {},
                {
                    model: def.httpModel,
                    messages: await langchainMessageToSparkMessage(
                        params.input,
                        this._plugin,
                        def.httpModel,
                        def.removeSystemMessage
                    ),
                    user: params.user,
                    stream: true,
                    temperature:
                        params.temperature ?? this._pluginConfig.temperature,
                    top_p: baseRequest.top_p,
                    presence_penalty: baseRequest.presence_penalty,
                    frequency_penalty: baseRequest.frequency_penalty,
                    max_tokens: baseRequest.max_tokens,
                    tools: baseRequest.tools
                } satisfies ChatCompletionRequest,
                params.overrideRequestParams ?? {}
            )

            if (
                request.tools != null &&
                def.apiPath === 'v1/chat/completions' &&
                request.tool_calls_switch == null
            ) {
                request.tool_calls_switch = true
            }

            const response = await this._post(
                def.apiPath,
                request,
                {
                    signal: params.signal
                },
                params.model
            )

            yield* processStreamResponse(
                requestContext,
                this._validateSparkStream(
                    sseIterable(response, params.timeout, params.signal)
                )
            )
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            }

            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
        } finally {
            this._requestConfig = undefined
        }
    }

    private async *_validateSparkStream(
        iterator: AsyncGenerator<SSEEvent, string, unknown>
    ): AsyncGenerator<SSEEvent, string, unknown> {
        for await (const event of iterator) {
            const chunk = event.data

            if (
                chunk === '[DONE]' ||
                chunk == null ||
                chunk === '' ||
                chunk === 'undefined'
            ) {
                yield event
                continue
            }

            try {
                const data = JSON.parse(chunk) as ChatCompletionResponse

                if (data.code != null && data.code !== 0) {
                    throw new ChatLunaError(
                        ChatLunaErrorCode.API_REQUEST_FAILED,
                        new Error(
                            'error when calling spark completion, Result: ' +
                                chunk
                        )
                    )
                }
            } catch (err) {
                if (err instanceof ChatLunaError) {
                    throw err
                }
            }

            yield event
        }

        return ''
    }

    private _post(
        url: string,
        data: ChatCompletionRequest,
        params: fetchType.RequestInit = {},
        model?: string
    ) {
        const body = JSON.stringify(data)

        return this._plugin.fetch(`https://spark-api-open.xf-yun.com/${url}`, {
            body,
            headers: this._buildHeaders(model ?? data.model),
            method: 'POST',
            ...params
        })
    }

    private _buildHeaders(model: string) {
        const key = getSparkModelPassword(
            this._getRequestConfig().value.apiPasswords,
            model
        )

        if (key == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_KEY_UNAVAILABLE,
                new Error(`没有找到模型 "${model}" 的 API 密钥`)
            )
        }

        return {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
        }
    }

    private _getModelDefinition(model: string) {
        const definition = getSparkModelDefinition(model)

        if (definition == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.MODEL_NOT_FOUND,
                new Error(`Model ${model} not found`)
            )
        }

        return definition
    }

    private _getRequestConfig(): ClientConfigWrapper<SparkClientConfig> {
        if (this._requestConfig != null) {
            return this._requestConfig
        }

        return this._configPool.getConfig(true)
    }

    private _selectConfigForModel(
        model: string
    ): ClientConfigWrapper<SparkClientConfig> {
        const configs = this._configPool.getConfigs().filter((config) => {
            return (
                getSparkModelPassword(config.value.apiPasswords, model) != null
            )
        })

        if (configs.length < 1) {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_KEY_UNAVAILABLE,
                new Error(`没有找到模型 "${model}" 的 API 密钥`)
            )
        }

        const available = configs.filter((config) => config.isAvailable)

        if (available.length < 1) {
            throw new ChatLunaError(ChatLunaErrorCode.NOT_AVAILABLE_CONFIG)
        }

        const idx = this._modelConfigCursor[model] ?? 0
        const config = available[idx % available.length]

        this._modelConfigCursor[model] = (idx + 1) % available.length

        return config
    }

    get logger() {
        return logger
    }
}
