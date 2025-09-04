import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    ClientConfig,
    ClientConfigPool
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { Context } from 'koishi'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import { Config, logger } from '.'
import { ClaudeDeltaResponse, ClaudeRequest } from './types'
import {
    convertDeltaToMessageChunk,
    formatToolsToClaudeTools,
    langchainMessageToClaudeMessage
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export class ClaudeRequester extends ModelRequester<ClientConfig> {
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
        let reasoningContent = ''
        let isSetReasoningTime = false
        let reasoningTime = 0

        const response = await this.post('messages', {
            model: params.model.replace('thinking', ''),
            max_tokens: params.maxTokens ?? 4096,
            temperature: params.temperature,
            top_p: params.topP,
            stop_sequences:
                typeof params.stop === 'string' ? [params.stop] : params.stop,
            stream: true,
            messages: await langchainMessageToClaudeMessage(
                params.input,
                this._plugin,
                params.model
            ),
            thinking: params.model.includes('thinking')
                ? {
                      type: 'enabled',
                      // TODO: customize
                      budget_tokens: 16000
                  }
                : undefined,
            tools:
                params.tools != null
                    ? formatToolsToClaudeTools(params.tools)
                    : undefined
        } satisfies ClaudeRequest)

        const iterator = sseIterable(response)

        for await (const event of iterator) {
            if (event.event === 'ping') continue

            if (event.event === 'error') {
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error(event.data)
                )
            }

            if (event.event === 'message_delta') return

            const chunk = event.data

            if (chunk === '[DONE]') {
                return
            }

            const parsedRawChunk = JSON.parse(chunk) as ClaudeDeltaResponse

            const parsedChunk = convertDeltaToMessageChunk(parsedRawChunk)

            // console.log(findTools, parsedRawChunk, parsedChunk)

            if (parsedChunk == null) continue

            if (
                parsedRawChunk.type === 'content_block_delta' &&
                parsedRawChunk.delta.type === 'thinking_delta'
            ) {
                reasoningContent = (reasoningContent +
                    parsedRawChunk.delta.thinking) as string

                parsedChunk.additional_kwargs.reasoning_content =
                    reasoningContent

                if (reasoningTime === 0) {
                    reasoningTime = Date.now()
                }
            }

            if (
                parsedChunk.additional_kwargs['reasoning_content'] == null &&
                parsedChunk.content &&
                parsedChunk.content.length > 0 &&
                reasoningTime > 0 &&
                !isSetReasoningTime
            ) {
                reasoningTime = Date.now() - reasoningTime
                parsedChunk.additional_kwargs.reasoning_time = reasoningTime
                isSetReasoningTime = true
            }

            yield new ChatGenerationChunk({
                message: parsedChunk,
                text: parsedChunk.content as string
            })
        }

        if (reasoningContent.length > 0) {
            logger.debug(
                `reasoning content: ${reasoningContent}. Use time: ${reasoningTime / 1000}s`
            )
        }
    }

    public buildHeaders() {
        return {
            'x-api-key': this._config.value.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        }
    }

    get logger() {
        return logger
    }
}
