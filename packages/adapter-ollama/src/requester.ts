import { AIMessageChunk, type UsageMetadata } from '@langchain/core/messages'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    EmbeddingsResult,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    ClientConfig,
    ClientConfigPool
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { rawSeeAsIterable } from 'koishi-plugin-chatluna/utils/sse'
import { Context } from 'koishi'
import {
    OllamaDeltaResponse,
    OllamaEmbedResponse,
    OllamaListResponse,
    OllamaModelSummary,
    OllamaRequest,
    OllamaShowResponse
} from './types'
import {
    formatToolsToOllamaTools,
    langchainMessageToOllamaMessage
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config, logger as pluginLogger } from '.'
import {
    ModelCapabilities,
    ModelInfo
} from 'koishi-plugin-chatluna/llm-core/platform/types'

function ollamaUsageToUsageMetadata(
    chunk: OllamaDeltaResponse
): UsageMetadata | undefined {
    if (chunk.prompt_eval_count == null && chunk.eval_count == null) {
        return undefined
    }

    const inputTokens = chunk.prompt_eval_count ?? 0
    const outputTokens = chunk.eval_count ?? 0

    return {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens
    }
}

function ollamaChunkToGeneration(chunk: OllamaDeltaResponse) {
    const content = chunk.message?.content ?? ''
    const thinking = chunk.message?.thinking
    const toolCallChunks =
        chunk.message?.tool_calls?.map((call, index) => ({
            name: call.function.name,
            args: JSON.stringify(call.function.arguments),
            id: call.id ?? `call_${call.function.index ?? index}`,
            index: call.function.index ?? index
        })) ?? []
    const usageMetadata = ollamaUsageToUsageMetadata(chunk)

    if (
        content.length < 1 &&
        thinking == null &&
        toolCallChunks.length < 1 &&
        usageMetadata == null
    ) {
        return undefined
    }

    return new ChatGenerationChunk({
        generationInfo:
            usageMetadata == null
                ? undefined
                : {
                      usage_metadata: usageMetadata
                  },
        message: new AIMessageChunk({
            content,
            tool_call_chunks: toolCallChunks,
            usage_metadata: usageMetadata,
            additional_kwargs:
                thinking == null
                    ? {}
                    : {
                          reasoning_content: thinking
                      }
        }),
        text: content
    })
}

export class OllamaRequester
    extends ModelRequester<ClientConfig>
    implements EmbeddingsRequester
{
    private _models: Record<string, ModelInfo> = {}

    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<ClientConfig>,
        public _plugin: ChatLunaPlugin<ClientConfig, Config>
    ) {
        super(ctx, _configPool, undefined, _plugin)
    }

    setModels(models: ModelInfo[]) {
        this._models = {}
        for (const model of models) {
            this._models[model.name] = model
        }
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        try {
            const rawModel = params.model ?? ''
            let model = rawModel
            let think: OllamaRequest['think']
            const effort = model.match(/-(low|medium|high|max)-thinking$/)

            if (effort?.[1] != null) {
                think = effort[1] as OllamaRequest['think']
                model = model.slice(0, -`-${effort[1]}-thinking`.length)
            } else if (model.endsWith('-non-thinking')) {
                think = false
                model = model.slice(0, -'-non-thinking'.length)
            } else if (model.endsWith('-thinking')) {
                think = true
                model = model.slice(0, -'-thinking'.length)
            }

            const info = (this._models[rawModel] ?? this._models[model])!

            if (
                think == null &&
                info.capabilities.includes(ModelCapabilities.Thinking)
            ) {
                think = model.toLowerCase().includes('gpt-oss')
                    ? 'medium'
                    : true
            }

            const response = await this.post(
                'api/chat',
                {
                    model,
                    messages: await langchainMessageToOllamaMessage(
                        params.input,
                        this._plugin,
                        info.capabilities.includes(
                            ModelCapabilities.ImageInput
                        ) ||
                            this._plugin.config.supportImageModels.includes(
                                model
                            ) ||
                            this._plugin.config.supportImageModels.includes(
                                rawModel
                            )
                    ),
                    tools:
                        params.tools != null &&
                        info.capabilities.includes(ModelCapabilities.ToolCall)
                            ? formatToolsToOllamaTools(params.tools)
                            : undefined,
                    think,
                    keep_alive: this._plugin.config.keepAlive ? -1 : undefined,
                    options: {
                        temperature: params.temperature,
                        // top_k: params.n,
                        top_p: params.topP,
                        stop: params.stop,
                        num_predict: params.maxTokens
                    },
                    stream: true
                } satisfies OllamaRequest,
                {
                    signal: params.signal
                }
            )

            let buffer = ''

            for await (const rawData of rawSeeAsIterable(response, 0)) {
                buffer += rawData

                const parts = buffer.split('\n')
                buffer = parts.pop() ?? ''

                for (const part of parts) {
                    if (part.trim().length < 1) continue

                    const chunk = JSON.parse(part) as OllamaDeltaResponse
                    const generation = ollamaChunkToGeneration(chunk)

                    if (generation != null) {
                        yield generation
                    }

                    if (chunk.done) return
                }
            }

            if (buffer.trim().length > 0) {
                const chunk = JSON.parse(buffer) as OllamaDeltaResponse
                const generation = ollamaChunkToGeneration(chunk)

                if (generation != null) {
                    yield generation
                }
            }
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            } else {
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            }
        }
    }

    async embeddings(
        params: EmbeddingsRequestParams
    ): Promise<EmbeddingsResult> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: OllamaEmbedResponse | string

        try {
            const response = await this.post('api/embed', {
                input: params.input,
                model: params.model,
                keep_alive: this._plugin.config.keepAlive ? -1 : undefined
            })

            data = await response.text()

            data = JSON.parse(data as string) as OllamaEmbedResponse

            if (data.embeddings && data.embeddings.length > 0) {
                if (typeof params.input === 'string') {
                    return data.embeddings[0]
                }
                return data.embeddings
            }

            throw new Error(
                'error when calling ollama embeddings, Result: ' +
                    JSON.stringify(data)
            )
        } catch (e) {
            const error = new Error(
                'error when calling ollama embeddings, Result: ' +
                    JSON.stringify(data)
            )

            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, error)
        }
    }

    async getModels(): Promise<OllamaModelSummary[]> {
        let data: OllamaListResponse | string
        try {
            const response = await this.get('api/tags')
            data = await response.text()
            data = JSON.parse(data as string) as OllamaListResponse

            return data.models
        } catch (e) {
            const error = new Error(
                'error when listing ollama models, Result: ' +
                    JSON.stringify(data)
            )

            error.stack = e.stack
            error.cause = e.cause

            throw error
        }
    }

    async getModelDetails(model: string): Promise<OllamaShowResponse> {
        let data: unknown
        try {
            const response = await this.post('api/show', { model })
            data = await response.text()

            return JSON.parse(data as string) as OllamaShowResponse
        } catch (e) {
            const error = new Error(
                'error when showing ollama model, Result: ' +
                    JSON.stringify(data)
            )

            error.stack = e.stack
            error.cause = e.cause

            throw error
        }
    }

    concatUrl(url: string): string {
        const apiEndPoint = this._config.value.apiEndpoint

        if (apiEndPoint.endsWith('/')) {
            return apiEndPoint + url
        }

        return apiEndPoint + '/' + url
    }

    get logger() {
        return pluginLogger
    }
}
