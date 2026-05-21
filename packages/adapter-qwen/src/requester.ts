import { ChatGenerationChunk } from '@langchain/core/outputs'
import { Context } from 'koishi'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import { Config } from '.'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    ClientConfig,
    ClientConfigPool
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    EmbeddingsResult,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    buildChatCompletionParams,
    createEmbeddings,
    createRequestContext,
    processStreamResponse
} from '@chatluna/v1-shared-adapter'

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
        const requestContext = createRequestContext(
            this.ctx,
            this._config.value,
            this._pluginConfig,
            this._plugin,
            this
        )

        let model = params.model
        let enabledThinking: boolean | undefined

        if (model.includes('thinking')) {
            enabledThinking = !model.includes('-non-thinking')
            model = model.replace('-non-thinking', '').replace('-thinking', '')
        } else if (model.includes('default')) {
            enabledThinking = true
            model = model.replace('-default', '-thinking')
        }

        const baseRequest = (await buildChatCompletionParams(
            {
                ...params,
                model,
                tools: model.includes('vl') ? undefined : params.tools
            },
            this._plugin,
            false,
            false
        )) as Awaited<ReturnType<typeof buildChatCompletionParams>> & {
            enabled_thinking?: boolean
            enable_search?: boolean
            parallel_tool_calls?: boolean
        }

        if (enabledThinking != null) {
            baseRequest.enabled_thinking = enabledThinking
        }

        baseRequest.parallel_tool_calls = true

        if (!model.includes('vl')) {
            baseRequest.enable_search = this._pluginConfig.enableSearch
        }

        try {
            const response = await this.post('chat/completions', baseRequest, {
                signal: params.signal
            })

            const iterator = sseIterable(response)
            const streamChunks = processStreamResponse(requestContext, iterator)

            for await (const chunk of streamChunks) {
                yield chunk
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
