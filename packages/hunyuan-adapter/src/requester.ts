import { ChatGenerationChunk } from '@langchain/core/outputs'
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
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import { Context } from 'koishi'
import { Config, logger as pluginLogger } from '.'
import {
    ChatCompletionResponse,
    ChatCompletionResponseMessageRoleEnum
} from './types'
import {
    createEmbeddings,
    createRequestContext
} from '@chatluna/v1-shared-adapter'
import {
    convertDeltaToMessageChunk,
    formatToolsToHunyuanTools,
    langchainMessageToHunyuanMessage
} from './utils'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export class HunyuanRequester
    extends ModelRequester<ClientConfig>
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
        try {
            const response = await this.post(
                'chat/completions',
                {
                    model: params.model,
                    messages: langchainMessageToHunyuanMessage(
                        params.input,
                        params.model
                    ),
                    tools:
                        params.tools != null && !params.model.includes('vision')
                            ? formatToolsToHunyuanTools(params.tools)
                            : undefined,
                    stream: true,
                    top_p: params.topP,
                    temperature: params.temperature,
                    enable_enhancement: params.model.includes('vision')
                        ? undefined
                        : this._pluginConfig.enableSearch
                },
                {
                    signal: params.signal
                }
            )

            const iterator = sseIterable(response)

            const defaultRole: ChatCompletionResponseMessageRoleEnum =
                'assistant'

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
                            'error when calling Hunyuan completion, Result: ' +
                                chunk
                        )
                    )
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if ((data as any).Response) {
                    // check DataInspectionFailed

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    if ((data as any).Error?.code.include('IllegalDetected')) {
                        throw new ChatLunaError(
                            ChatLunaErrorCode.API_UNSAFE_CONTENT,
                            new Error(
                                'Unsafe content detected, please try again.' +
                                    chunk
                            )
                        )
                    }

                    throw new ChatLunaError(
                        ChatLunaErrorCode.API_REQUEST_FAILED,
                        new Error(
                            'error when calling Hunyuan completion, Result: ' +
                                chunk
                        )
                    )
                }

                const choice = data.choices?.[0]

                if (!choice) {
                    continue
                }

                const messageChunk = convertDeltaToMessageChunk(
                    choice.delta,
                    defaultRole
                )

                const generationChunk = new ChatGenerationChunk({
                    message: messageChunk,
                    text: messageChunk.content as string
                })

                yield generationChunk

                if (choice.finish_reason === 'stop') {
                    break
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
        return 'https://api.hunyuan.cloud.tencent.com/v1/' + url
    }

    get logger() {
        return pluginLogger
    }
}
