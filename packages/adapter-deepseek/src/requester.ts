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
import { logger } from '.'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import {
    buildChatCompletionParams,
    completionStream,
    createEmbeddings,
    createRequestContext,
    parseOpenAIModelNameWithReasoningEffort,
    processStreamResponse
} from '@chatluna/v1-shared-adapter'
import { RunnableConfig } from '@langchain/core/runnables'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'

export class DeepseekRequester
    extends ModelRequester
    implements EmbeddingsRequester
{
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<ClientConfig>,
        _pluginConfig: ChatLunaPlugin.Config,
        _plugin: ChatLunaPlugin
    ) {
        super(ctx, _configPool, _pluginConfig, _plugin)
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        const rawModel = params.model
        const disabled = rawModel.endsWith('-instant')
        const parsedModel = parseOpenAIModelNameWithReasoningEffort(
            disabled ? rawModel.slice(0, -'-instant'.length) : rawModel
        )
        const model = parsedModel.model
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        if (!model.startsWith('deepseek-v4-')) {
            yield* completionStream(requestContext, params)
            return
        }

        const request = (await buildChatCompletionParams(
            { ...params, model: disabled ? model : rawModel },
            this._plugin,
            false,
            true
        )) as Awaited<ReturnType<typeof buildChatCompletionParams>> & {
            thinking?: {
                type: 'enabled' | 'disabled'
            }
        }

        request.thinking = {
            type: disabled ? 'disabled' : 'enabled'
        }

        if (disabled) {
            delete request.reasoning_effort
        } else {
            delete request.temperature
            delete request.presence_penalty
            delete request.frequency_penalty
            delete request.top_p
        }

        try {
            const response = await this.post('chat/completions', request, {
                signal: params.signal
            })

            yield* processStreamResponse(
                requestContext,
                sseIterable(response, params)
            )
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            }
            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
        }
    }

    async embeddings(
        params: EmbeddingsRequestParams
    ): Promise<EmbeddingsResult> {
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        return await createEmbeddings(requestContext, params)
    }

    async getModels(config?: RunnableConfig): Promise<string[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any
        try {
            const response = await this.get(
                'models',
                {},
                { signal: config?.signal }
            )
            data = await response.text()
            data = JSON.parse(data as string)

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (<Record<string, any>[]>data.data).map((model) => model.id)
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            }
            const error = new Error(
                'error when listing deepseek models, Result: ' +
                    JSON.stringify(data)
            )
            throw error
        }
    }

    get logger() {
        return logger
    }
}
