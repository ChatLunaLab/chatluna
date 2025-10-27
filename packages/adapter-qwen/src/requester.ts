import { ChatGenerationChunk } from '@langchain/core/outputs'
import { Context } from 'koishi'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { SSEEvent, sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import { Config } from '.'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { trackLogToLocal } from 'koishi-plugin-chatluna/utils/logger'
import {
    ClientConfig,
    ClientConfigPool
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    convertDeltaToMessageChunk,
    formatToolsToQWenTools,
    langchainMessageToQWenMessage
} from './utils'
import {
    ChatCompletionResponse,
    ChatCompletionResponseMessageRoleEnum
} from './types'
import {
    createEmbeddings,
    createRequestContext
} from '@chatluna/v1-shared-adapter'
import { AIMessageChunk } from '@langchain/core/messages'
import { logger } from 'koishi-plugin-chatluna'

export class QWenRequester
    extends ModelRequester
    implements EmbeddingsRequester
{
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<ClientConfig>,
        public _pluginConfig: Config,
        _plugin: ChatLunaPlugin
    ) {
        super(ctx, _configPool, _pluginConfig, _plugin)
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        let model = params.model

        let enabledThinking: boolean | undefined = null

        if (model.includes('thinking')) {
            enabledThinking = !model.includes('-non-thinking')
            model = model.replace('-non-thinking', '').replace('-thinking', '')
        } else if (model.includes('default')) {
            enabledThinking = true
            model = model.replace('-default', '-thinking')
        }

        const requestParams = {
            model,
            messages: await langchainMessageToQWenMessage(
                params.input,
                this._plugin,
                model
            ),
            tools:
                params.tools != null && !params.model.includes('vl')
                    ? formatToolsToQWenTools(params.tools)
                    : undefined,
            stream: true,
            top_p: params.topP,
            temperature: params.temperature,
            enable_search: params.model.includes('vl')
                ? undefined
                : this._pluginConfig.enableSearch,
            enabled_thinking: enabledThinking
        }

        try {
            const response = await this.post(
                'chat/completions',
                requestParams,
                {
                    signal: params.signal
                }
            )

            let iterator: AsyncGenerator<SSEEvent, string, unknown>

            try {
                iterator = sseIterable(response)
            } catch (e) {
                if (
                    e instanceof ChatLunaError &&
                    e.message.includes('data_inspection_failed')
                ) {
                    throw new ChatLunaError(
                        ChatLunaErrorCode.API_UNSAFE_CONTENT,
                        e
                    )
                }

                throw e
            }

            const defaultRole: ChatCompletionResponseMessageRoleEnum =
                'assistant'

            let reasoningContent = ''
            let isSetReasoningTime = false
            let reasoningTime = 0

            for await (const event of iterator) {
                const chunk = event.data

                if (chunk === '[DONE]') {
                    return
                }

                let data: ChatCompletionResponse

                try {
                    data = JSON.parse(chunk)
                } catch (err) {
                    throw new ChatLunaError(
                        ChatLunaErrorCode.API_REQUEST_FAILED,
                        new Error(
                            'error when calling qwen completion, Result: ' +
                                chunk
                        )
                    )
                }

                const choice = data.choices?.[0]

                if (data.usage) {
                    yield new ChatGenerationChunk({
                        message: new AIMessageChunk({
                            content: '',
                            response_metadata: {
                                tokenUsage: {
                                    promptTokens: data.usage.prompt_tokens,
                                    completionTokens:
                                        data.usage.completion_tokens,
                                    totalTokens: data.usage.total_tokens
                                }
                            }
                        }),
                        text: ''
                    })
                }

                if (!choice) {
                    continue
                }

                const delta = choice.delta
                const messageChunk = convertDeltaToMessageChunk(
                    delta,
                    defaultRole
                )

                if (delta.reasoning_content) {
                    reasoningContent = (reasoningContent +
                        delta.reasoning_content) as string

                    if (reasoningTime === 0) {
                        reasoningTime = Date.now()
                    }
                }

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

                const generationChunk = new ChatGenerationChunk({
                    message: messageChunk,
                    text: messageChunk.content as string
                })

                yield generationChunk

                if (choice.finish_reason === 'stop') {
                    break
                }
            }

            if (reasoningContent.length > 0) {
                logger.debug(
                    'reasoningContent: ' +
                        reasoningContent +
                        ', reasoningTime: ' +
                        reasoningTime / 1000 +
                        's'
                )
            }
        } catch (e) {
            if (this.ctx.chatluna.config.isLog) {
                await trackLogToLocal(
                    'Request',
                    JSON.stringify(requestParams),
                    this.logger
                )
            }
            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
        }
    }

    async embeddings(
        params: EmbeddingsRequestParams
    ): Promise<number[] | number[][]> {
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        return await createEmbeddings(requestContext, params)
    }

    concatUrl(url: string): string {
        return 'https://dashscope.aliyuncs.com/compatible-mode/v1/' + url
    }

    get logger() {
        return this.ctx.logger('chatluna-qwen-adapter')
    }
}
