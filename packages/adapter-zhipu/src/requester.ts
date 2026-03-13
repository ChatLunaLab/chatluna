import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    buildChatCompletionParams,
    createEmbeddings,
    createRequestContext,
    processStreamResponse,
    supportImageInput
} from '@chatluna/v1-shared-adapter'
import { Context } from 'koishi'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    ClientConfig,
    ClientConfigPool
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import { Config, logger } from '.'
import { ChatCompletionResponseMessage, ChatCompletionTool } from './types'
import {
    formatToolsToZhipuTools,
    langchainMessageToZhipuMessage
} from './utils'

type ZhipuChatRequest = Omit<
    Awaited<ReturnType<typeof buildChatCompletionParams>>,
    'messages' | 'tools'
> & {
    messages?: ChatCompletionResponseMessage[]
    tools?: ChatCompletionTool[]
    user?: string
}

export class ZhipuRequester
    extends ModelRequester
    implements EmbeddingsRequester
{
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<ClientConfig>,
        _pluginConfig: Config,
        _plugin: ChatLunaPlugin
    ) {
        super(ctx, _configPool, _pluginConfig, _plugin)
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )
        const isVisionModel = supportImageInput(params.model)
        const isToolModel = params.model.includes('tools')
        const request = (await buildChatCompletionParams(
            {
                ...params,
                tools: isVisionModel ? undefined : params.tools
            },
            this._plugin,
            false,
            false
        )) as ZhipuChatRequest

        request.messages = await langchainMessageToZhipuMessage(
            params.input,
            this._plugin,
            params.model
        )
        request.tools = isVisionModel
            ? undefined
            : formatToolsToZhipuTools(
                  params.model,
                  params.tools ?? [],
                  this._config.value
              )
        request.max_tokens = isVisionModel ? undefined : request.max_tokens
        request.user = isToolModel ? undefined : (params.user ?? 'user')

        if (isToolModel) {
            delete request.presence_penalty
            delete request.frequency_penalty
        }

        try {
            const response = await this.post('chat/completions', request, {
                signal: params.signal
            })

            yield* processStreamResponse(requestContext, sseIterable(response))
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            }

            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
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

        return await createEmbeddings(requestContext, params, 'embeddings')
    }

    concatUrl(url: string): string {
        return `https://open.bigmodel.cn/api/paas/v4/${url}`
    }

    buildHeaders() {
        return {
            Authorization: this._config.value.apiKey,
            'Content-Type': 'application/json',
            accept: 'text/event-stream'
        }
    }

    get logger() {
        return logger
    }
}
