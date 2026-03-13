import { AIMessageChunk } from '@langchain/core/messages'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import { Context } from 'koishi'
import {
    ClientConfig,
    ClientConfigPool
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { deepAssign } from 'koishi-plugin-chatluna/utils/object'
import { createUsageMetadata } from '@chatluna/v1-shared-adapter'
import { Config, logger } from '.'
import {
    ClaudeDeltaResponse,
    ClaudeListModelsResponse,
    ClaudeReasoningBlockParam,
    ClaudeRequest
} from './types'
import {
    convertDeltaToMessageChunk,
    formatToolsToClaudeTools,
    langchainMessageToClaudeMessage
} from './utils'

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
        const model = (params.model ?? '').replace('-thinking-', '-')
        const maxTokens = params.maxTokens ?? 4096
        const request = deepAssign(
            {},
            {
                model,
                max_tokens: maxTokens,
                temperature: params.temperature,
                top_p: params.topP,
                stop_sequences:
                    typeof params.stop === 'string'
                        ? [params.stop]
                        : params.stop,
                stream: true,
                messages: await langchainMessageToClaudeMessage(
                    params.input,
                    this._plugin,
                    model
                ),
                thinking: params.model?.includes('thinking')
                    ? {
                          type: 'enabled',
                          budget_tokens: Math.max(
                              1,
                              Math.min(16000, maxTokens - 1)
                          )
                      }
                    : undefined,
                tools:
                    params.tools != null
                        ? formatToolsToClaudeTools(params.tools)
                        : undefined
            } satisfies ClaudeRequest,
            params.overrideRequestParams ?? {}
        ) as ClaudeRequest
        request.stream = true

        const betas = new Set<string>()
        const rawBetas = request.anthropicBeta ?? request['anthropic-beta']

        if (typeof rawBetas === 'string' && rawBetas.length > 0) {
            for (const beta of rawBetas.split(',')) {
                const trimmed = beta.trim()
                if (trimmed.length > 0) {
                    betas.add(trimmed)
                }
            }
        } else if (Array.isArray(rawBetas)) {
            for (const beta of rawBetas) {
                const trimmed = typeof beta === 'string' ? beta.trim() : ''
                if (trimmed.length > 0) {
                    betas.add(trimmed)
                }
            }
        }

        delete request.anthropicBeta
        delete request['anthropic-beta']

        if (
            request.thinking != null &&
            request.thinking.type !== 'disabled' &&
            !request.model.startsWith('claude-opus-4-6') &&
            (request.model.includes('claude-3-7-') ||
                request.model.includes('claude-sonnet-4') ||
                request.model.includes('claude-opus-4-') ||
                request.model.includes('claude-haiku-4'))
        ) {
            betas.add('interleaved-thinking-2025-05-14')
        }

        const response = await this.post('messages', request, {
            signal: params.signal,
            headers:
                betas.size > 0
                    ? {
                          'anthropic-beta': Array.from(betas).join(',')
                      }
                    : undefined
        })

        const iterator = sseIterable(response)
        const reasoningState = {
            content: '',
            startedAt: Date.now(),
            endedAt: undefined as number | undefined,
            blocks: [] as ClaudeReasoningBlockParam[]
        }

        for await (const event of iterator) {
            if (event.event === 'ping') continue

            if (event.event === 'error') {
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error(event.data)
                )
            }

            const chunk = event.data

            if (chunk === '[DONE]') {
                break
            }

            if (chunk === '' || chunk == null || chunk === 'undefined') {
                continue
            }

            const parsedRawChunk = JSON.parse(chunk) as ClaudeDeltaResponse
            const usage =
                parsedRawChunk.type === 'message_start'
                    ? parsedRawChunk.message.usage
                    : parsedRawChunk.type === 'message_delta'
                      ? parsedRawChunk.usage
                      : undefined

            if (usage != null) {
                const usageMetadata = createUsageMetadata({
                    inputTokens: usage.input_tokens,
                    outputTokens: usage.output_tokens,
                    totalTokens: usage.input_tokens + usage.output_tokens,
                    cacheReadTokens: usage.cache_read_input_tokens,
                    cacheCreationTokens: usage.cache_creation_input_tokens
                })

                yield new ChatGenerationChunk({
                    generationInfo: {
                        usage_metadata: usageMetadata
                    },
                    message: new AIMessageChunk({
                        content: '',
                        usage_metadata: usageMetadata
                    }),
                    text: ''
                })
            }

            if (
                parsedRawChunk.type === 'message_delta' ||
                parsedRawChunk.type === 'message_stop' ||
                parsedRawChunk.type === 'content_block_stop'
            ) {
                continue
            }

            if (
                parsedRawChunk.type === 'content_block_start' &&
                parsedRawChunk.content_block.type === 'thinking'
            ) {
                const content = parsedRawChunk.content_block.thinking ?? ''

                reasoningState.content += content
                reasoningState.blocks[parsedRawChunk.index] = {
                    type: 'thinking',
                    thinking: content,
                    signature: parsedRawChunk.content_block.signature ?? ''
                }
                continue
            }

            if (
                parsedRawChunk.type === 'content_block_start' &&
                parsedRawChunk.content_block.type === 'redacted_thinking'
            ) {
                reasoningState.blocks[parsedRawChunk.index] = {
                    type: 'redacted_thinking',
                    data: parsedRawChunk.content_block.data ?? ''
                }
                continue
            }

            if (
                parsedRawChunk.type === 'content_block_delta' &&
                parsedRawChunk.delta.type === 'thinking_delta'
            ) {
                reasoningState.content += parsedRawChunk.delta.thinking

                const block = reasoningState.blocks[parsedRawChunk.index]
                if (block?.type === 'thinking') {
                    block.thinking += parsedRawChunk.delta.thinking
                }
                continue
            }

            if (
                parsedRawChunk.type === 'content_block_delta' &&
                parsedRawChunk.delta.type === 'signature_delta'
            ) {
                const block = reasoningState.blocks[parsedRawChunk.index]
                if (block?.type === 'thinking') {
                    block.signature = parsedRawChunk.delta.signature
                }
                continue
            }

            const parsedChunk = convertDeltaToMessageChunk(parsedRawChunk)

            if (parsedChunk == null) continue

            const hasMessageChunk =
                (typeof parsedChunk.content === 'string'
                    ? parsedChunk.content.length > 0
                    : Array.isArray(parsedChunk.content) &&
                      parsedChunk.content.length > 0) ||
                (parsedChunk instanceof AIMessageChunk &&
                    (parsedChunk.tool_call_chunks?.length ?? 0) > 0)

            if (reasoningState.endedAt == null && hasMessageChunk) {
                reasoningState.endedAt = Date.now()
            }

            if (!hasMessageChunk) {
                continue
            }

            yield new ChatGenerationChunk({
                message: parsedChunk,
                text: parsedChunk.content as string
            })
        }

        const reasoningBlocks = reasoningState.blocks.filter(
            (block): block is ClaudeReasoningBlockParam =>
                block != null &&
                (block.type === 'redacted_thinking' ||
                    block.signature.length > 0)
        )

        if (reasoningState.content.length > 0 || reasoningBlocks.length > 0) {
            const reasoningTime =
                (reasoningState.endedAt ?? Date.now()) -
                reasoningState.startedAt
            const reasoningSignature =
                reasoningBlocks.length === 1 &&
                reasoningBlocks[0].type === 'thinking'
                    ? reasoningBlocks[0].signature
                    : undefined

            yield new ChatGenerationChunk({
                message: new AIMessageChunk({
                    content: '',
                    additional_kwargs: {
                        reasoning_content: reasoningState.content,
                        ...(reasoningSignature != null
                            ? { reasoning_signature: reasoningSignature }
                            : {}),
                        ...(reasoningBlocks.length > 0
                            ? { reasoning_blocks: reasoningBlocks }
                            : {}),
                        ...(reasoningTime != null
                            ? { reasoning_time: reasoningTime }
                            : {})
                    }
                }),
                text: ''
            })

            logger.debug(
                `reasoning content: ${reasoningState.content}. Use time: ${(reasoningTime ?? 0) / 1000}s`
            )
        }
    }

    async listModels(options?: {
        afterId?: string
        beforeId?: string
        limit?: number
        anthropicBeta?: string[]
    }): Promise<ClaudeListModelsResponse> {
        const query = new URLSearchParams()

        if (options?.afterId) query.set('after_id', options.afterId)
        if (options?.beforeId) query.set('before_id', options.beforeId)
        if (typeof options?.limit === 'number') {
            query.set('limit', String(options.limit))
        }

        const url = query.size > 0 ? `models?${query.toString()}` : 'models'

        const headers =
            Array.isArray(options?.anthropicBeta) &&
            options.anthropicBeta.length > 0
                ? { 'anthropic-beta': options.anthropicBeta.join(',') }
                : undefined

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let raw: any
        try {
            const response = await this.get(url, headers)

            raw = await response.text()
            if (response.status !== 200) {
                throw new Error(
                    `Error when listing models, Status: ${response.status} ${response.statusText}, Response: ${raw}`
                )
            }

            return JSON.parse(raw) as ClaudeListModelsResponse
        } catch (e) {
            const error = new Error(
                'Error when listing models, Response: ' + JSON.stringify(raw)
            )
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(error as any).stack = (e as any)?.stack
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(error as any).cause = (e as any)?.cause
            throw error
        }
    }

    public buildHeaders() {
        return {
            Authorization: `Bearer ${this._config.value.apiKey}`,
            'x-api-key': this._config.value.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        }
    }

    get logger() {
        return logger
    }
}
