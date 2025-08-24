import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { ClientConfigPool } from 'koishi-plugin-chatluna/llm-core/platform/config'
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
    ChatCompletionResponse,
    SparkClientConfig
} from './types'
import {
    convertDeltaToMessageChunk,
    formatToolsToSparkTools,
    langchainMessageToSparkMessage,
    modelMapping
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

let logger: Logger

export class SparkRequester extends ModelRequester<SparkClientConfig> {
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<SparkClientConfig>,
        public _pluginConfig: Config,
        _plugin: ChatLunaPlugin
    ) {
        super(ctx, _configPool, _pluginConfig, _plugin)
        logger = createLogger(ctx, 'chatluna-spark-adapter')
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        await this.init()

        const messagesMapped = langchainMessageToSparkMessage(
            params.input,
            params.model.includes('assistant')
        )

        try {
            const response = await this._post(
                this._getApiPath(params.model),
                {
                    model: this._getModelName(params.model),
                    messages: messagesMapped,
                    stream: true,
                    temperature:
                        params.temperature ?? this._pluginConfig.temperature,
                    max_tokens: params.maxTokens,
                    tools:
                        params.tools != null
                            ? formatToolsToSparkTools(params.tools)
                            : undefined
                },
                {
                    signal: params.signal
                }
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

                try {
                    const data = JSON.parse(chunk) as ChatCompletionResponse

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    if ((data as any).error) {
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
        }
    }

    private _getApiPath(model: string): string {
        if (model === 'spark-x1') {
            return 'v2/chat/completions'
        }
        return 'v1/chat/completions'
    }

    private _getModelName(model: string): string {
        const mappedModel = modelMapping[model as keyof typeof modelMapping]
        return mappedModel?.httpModel ?? model
    }

    private _getBaseUrl(model: string): string {
        return 'https://spark-api-open.xf-yun.com'
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _post(url: string, data: any, params: fetchType.RequestInit = {}) {
        const body = JSON.stringify(data)

        const fullUrl = `${this._getBaseUrl('')}/${url}`

        return this._plugin.fetch(fullUrl, {
            body,
            headers: this._buildHeaders(data['model']),
            method: 'POST',
            ...params
        })
    }

    private _buildHeaders(model: string) {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        }

        const modelName = Object.entries(modelMapping).find(([, value]) => {
            return value.model === model || value.httpModel === model
        })?.[0]

        const modelAlias = [
            model,
            modelMapping[model as keyof typeof modelMapping]?.model,
            modelName
                .split('-')
                .map(
                    (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
                )
                .join(' ')
        ]

        const key = modelAlias
            .map((alias) => this._config.value.apiPasswords[alias])
            .filter((key) => key != null)
            .at(0)

        if (key == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_KEY_UNAVAILABLE,
                new Error(`没有找到模型 "${model}" 的 API 密钥`)
            )
        }

        headers.Authorization = `Bearer ${key}`

        return headers
    }

    get logger() {
        return logger
    }
}
