import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    ClientConfigPool,
    ClientConfigWrapper
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import { Context, Logger } from 'koishi'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import * as fetchType from 'undici/types/fetch'
import { Config } from '.'
import {
    ChatCompletionMessageRoleEnum,
    ChatCompletionRequest,
    ChatCompletionResponse,
    SparkClientConfig
} from './types'
import {
    convertDeltaToMessageChunk,
    formatToolsToSparkTools,
    getSparkModelDefinition,
    getSparkModelPassword,
    langchainMessageToSparkMessage
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { deepAssign } from 'koishi-plugin-chatluna/utils/object'

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

        const modelDefinition = this._getModelDefinition(params.model)

        const messagesMapped = langchainMessageToSparkMessage(
            params.input,
            modelDefinition.removeSystemMessage
        )

        try {
            const request = deepAssign(
                {},
                {
                    model: modelDefinition.httpModel,
                    messages: messagesMapped,
                    user: params.user,
                    stream: true,
                    temperature:
                        params.temperature ?? this._pluginConfig.temperature,
                    top_p: params.topP,
                    presence_penalty: params.presencePenalty,
                    frequency_penalty: params.frequencyPenalty,
                    max_tokens: params.maxTokens,
                    tools:
                        params.tools != null
                            ? formatToolsToSparkTools(params.tools)
                            : undefined
                } satisfies ChatCompletionRequest,
                params.overrideRequestParams ?? {}
            )

            if (
                request.tools != null &&
                modelDefinition.apiPath === 'v1/chat/completions' &&
                request.tool_calls_switch == null
            ) {
                request.tool_calls_switch = true
            }

            const response = await this._post(
                this._getApiPath(params.model),
                request,
                {
                    signal: params.signal
                },
                params.model
            )

            const iterator = sseIterable(response)
            let defaultRole: ChatCompletionMessageRoleEnum = 'assistant'
            let errorCount = 0

            // Support for reasoning models (like X1)
            let reasoningContent = ''
            let reasoningTime = 0
            let isSetReasoningTime = false

            for await (const event of iterator) {
                const chunk = event.data
                if (chunk === '[DONE]') {
                    break
                }

                if (chunk == null || chunk === '' || chunk === 'undefined') {
                    continue
                }

                try {
                    const data = JSON.parse(chunk) as ChatCompletionResponse

                    if (
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (data as any).error ||
                        (data.code != null && data.code !== 0)
                    ) {
                        throw new ChatLunaError(
                            ChatLunaErrorCode.API_REQUEST_FAILED,
                            new Error(
                                'error when calling spark completion, Result: ' +
                                    chunk
                            )
                        )
                    }

                    const choice = data.choices?.[0]
                    if (!choice) {
                        continue
                    }

                    const { delta } = choice
                    if (!delta) {
                        continue
                    }

                    // Handle reasoning content for thinking models
                    if (delta.reasoning_content) {
                        reasoningContent = (reasoningContent +
                            delta.reasoning_content) as string

                        if (reasoningTime === 0) {
                            reasoningTime = Date.now()
                        }
                    }

                    const messageChunk = convertDeltaToMessageChunk(
                        delta,
                        defaultRole
                    )

                    // Set reasoning time when actual content starts
                    if (
                        (delta.reasoning_content == null ||
                            delta.reasoning_content === '') &&
                        delta.content &&
                        delta.content.length > 0 &&
                        reasoningTime > 0 &&
                        !isSetReasoningTime
                    ) {
                        reasoningTime = Date.now() - reasoningTime
                        messageChunk.additional_kwargs.reasoning_time =
                            reasoningTime
                        isSetReasoningTime = true
                    }

                    defaultRole = (
                        (delta.role?.length ?? 0) > 0 ? delta.role : defaultRole
                    ) as ChatCompletionMessageRoleEnum

                    const generationChunk = new ChatGenerationChunk({
                        message: messageChunk,
                        text: messageChunk.content as string
                    })

                    yield generationChunk
                } catch (e) {
                    if (errorCount > 5) {
                        logger.error('error with chunk', chunk)
                        throw new ChatLunaError(
                            ChatLunaErrorCode.API_REQUEST_FAILED,
                            e
                        )
                    } else {
                        errorCount++
                        continue
                    }
                }
            }

            // Log reasoning content for debugging
            if (reasoningContent.length > 0) {
                logger.debug(
                    `reasoning content: ${reasoningContent}. Use time: ${reasoningTime / 1000} s.`
                )
            }
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
        } finally {
            this._requestConfig = undefined
        }
    }

    private _getApiPath(model: string): string {
        return this._getModelDefinition(model).apiPath
    }

    private _getBaseUrl(): string {
        return 'https://spark-api-open.xf-yun.com'
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _post(
        url: string,
        data: ChatCompletionRequest,
        params: fetchType.RequestInit = {},
        model?: string
    ) {
        const body = JSON.stringify(data)

        const fullUrl = `${this._getBaseUrl()}/${url}`

        return this._plugin.fetch(fullUrl, {
            body,
            headers: this._buildHeaders(model ?? data.model),
            method: 'POST',
            ...params
        })
    }

    private _buildHeaders(model: string) {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        }

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

        headers.Authorization = `Bearer ${key}`

        return headers
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
        const matchedConfigs = this._configPool
            .getConfigs()
            .filter((config) => {
                return (
                    getSparkModelPassword(config.value.apiPasswords, model) !=
                    null
                )
            })

        if (matchedConfigs.length < 1) {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_KEY_UNAVAILABLE,
                new Error(`没有找到模型 "${model}" 的 API 密钥`)
            )
        }

        const availableConfigs = matchedConfigs.filter(
            (config) => config.isAvailable
        )

        if (availableConfigs.length < 1) {
            throw new ChatLunaError(ChatLunaErrorCode.NOT_AVAILABLE_CONFIG)
        }

        const cursor = this._modelConfigCursor[model] ?? 0
        const config = availableConfigs[cursor % availableConfigs.length]

        this._modelConfigCursor[model] = (cursor + 1) % availableConfigs.length

        return config
    }

    get logger() {
        return logger
    }
}
