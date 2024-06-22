import { ToolCallChunk } from '@langchain/core/messages/tool'
import {
    AIMessageChunk,
    BaseMessageChunk,
    ChatMessageChunk,
    FunctionMessageChunk,
    HumanMessageChunk,
    OpenAIToolCall,
    SystemMessageChunk,
    ToolMessageChunk
} from '@langchain/core/messages'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { chatLunaFetch } from 'koishi-plugin-chatluna/utils/request'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import * as fetchType from 'undici/types/fetch'
import { Config } from '.'
import {
    ChatCompletionResponseMessageRoleEnum,
    ChatCompletionStreamResponse,
    CreateEmbeddingResponse
} from './types'
import {
    convertDeltaToMessageChunk,
    formatToolsToQWenTools,
    langchainMessageToQWenMessage
} from './utils'

export class QWenRequester
    extends ModelRequester
    implements EmbeddingsRequester
{
    constructor(
        private _config: ClientConfig,
        private _pluginConfig: Config
    ) {
        super()
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        try {
            const response = await this._post(
                'v1/services/aigc/text-generation/generation',
                {
                    model: params.model,
                    input: {
                        messages: langchainMessageToQWenMessage(params.input)
                    },
                    parameters: {
                        tools:
                            params.tools != null
                                ? formatToolsToQWenTools(params.tools)
                                : undefined,
                        result_format: 'message',
                        top_p: params.topP,
                        temperature: params.temperature,
                        enable_search: this._pluginConfig.enableSearch
                    }
                },
                {
                    signal: params.signal
                }
            )

            const findTools = params.tools != null

            const iterator = sseIterable(response)

            let firstCall = true

            const defaultRole: ChatCompletionResponseMessageRoleEnum =
                'assistant'

            let lastMessageChunk: BaseMessageChunk = new ChatMessageChunk({
                content: '',
                role: defaultRole
            })

            for await (const event of iterator) {
                const chunk = event.data
                if (chunk === '[DONE]') {
                    return
                }

                let data: ChatCompletionStreamResponse

                try {
                    data = JSON.parse(chunk) as ChatCompletionStreamResponse
                } catch (err) {
                    throw new ChatLunaError(
                        ChatLunaErrorCode.API_REQUEST_FAILED,
                        new Error(
                            'error when calling qwen completion, Result: ' +
                                chunk
                        )
                    )
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                if ((data as any).message) {
                    throw new ChatLunaError(
                        ChatLunaErrorCode.API_REQUEST_FAILED,
                        new Error(
                            'error when calling qwen completion, Result: ' +
                                chunk
                        )
                    )
                }

                const choice = data.output.choices?.[0].message
                if (!choice) {
                    continue
                }

                const messageChunk = convertDeltaToMessageChunk(
                    choice,
                    defaultRole
                )

                let generationChunk = new ChatGenerationChunk({
                    message: messageChunk,
                    text: messageChunk.content as string
                })

                if (findTools) {
                    const diffMessageChunk = this._diffChunk(
                        messageChunk,
                        lastMessageChunk,
                        firstCall
                    ) as AIMessageChunk

                    generationChunk = new ChatGenerationChunk({
                        message: diffMessageChunk,
                        text: diffMessageChunk.content as string
                    })

                    if (
                        diffMessageChunk.additional_kwargs.tool_calls?.[0]
                            ?.type === 'function'
                    ) {
                        firstCall = false
                    }
                }

                yield generationChunk

                lastMessageChunk = messageChunk

                if (data.output.choices[0]?.finish_reason === 'stop') {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: CreateEmbeddingResponse | string

        if (
            typeof params.input === 'string' &&
            params.input.trim().length < 1
        ) {
            return []
        }

        try {
            const response = await this._post(
                `v1/services/embeddings/text-embedding/text-embedding`,
                {
                    'version-id': 'v1',
                    'task-group': 'embeddings',
                    task: 'text-embedding',
                    'function-call': 'text-embedding',
                    model: params.model,
                    input: {
                        texts:
                            params.input instanceof Array
                                ? params.input
                                : [params.input]
                    },
                    parameters: {
                        text_type: 'query'
                    }
                }
            )

            data = await response.text()

            data = JSON.parse(data) as CreateEmbeddingResponse

            if (data.output && data.output.embeddings?.length > 0) {
                const rawEmbeddings = (
                    data as CreateEmbeddingResponse
                ).output.embeddings.map((it) => it.embedding)

                if (params.input instanceof Array) {
                    return rawEmbeddings
                }

                return rawEmbeddings[0]
            }

            throw new Error(
                'error when calling qwen embeddings, Result: ' +
                    JSON.stringify(data)
            )
        } catch (e) {
            const error = new Error(
                'error when calling qwen embeddings, Result: ' +
                    JSON.stringify(data)
            )

            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, error)
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _post(url: string, data: any, params: fetchType.RequestInit = {}) {
        const requestUrl = this._concatUrl(url)

        const body = JSON.stringify(data)

        console.log(body)
        return chatLunaFetch(requestUrl, {
            body,
            headers: this._buildHeaders(!url.includes('text-embedding')),
            method: 'POST',
            ...params
        })
    }

    private _buildHeaders(stream: boolean = true) {
        return {
            Authorization: `Bearer ${this._config.apiKey}`,
            Accept: stream ? 'text/event-stream' : '*/*',
            'Content-Type': 'application/json'
        }
    }

    private _concatUrl(url: string): string {
        return 'https://dashscope.aliyuncs.com/api/' + url
    }

    async init(): Promise<void> {}

    async dispose(): Promise<void> {}

    private _diffChunk(
        messageChunk: BaseMessageChunk,
        baseMessageChunk: BaseMessageChunk,
        firstCall: boolean = true
    ) {
        // diff content

        // maybe the function is not incremental
        // just change the content
        const cloned = cloneMessageChunk(messageChunk)

        if (messageChunk.content !== baseMessageChunk.content) {
            cloned.content = messageChunk.content.slice(
                baseMessageChunk.content.length
            )
        }

        if (cloned instanceof AIMessageChunk) {
            cloned.tool_call_chunks = this._diffToolCallChunks(
                (baseMessageChunk as AIMessageChunk).tool_call_chunks,
                (messageChunk as AIMessageChunk).tool_call_chunks
            )

            cloned.additional_kwargs.tool_calls = cloned.tool_call_chunks.map(
                (it, index) => {
                    return {
                        type: firstCall ? 'function' : undefined,
                        function: {
                            name: it.name,
                            arguments: it.args
                        },
                        id: it.id,
                        index
                    } satisfies OpenAIToolCall
                }
            )

            if (baseMessageChunk.additional_kwargs.first_call === true) {
                messageChunk.additional_kwargs.first_call = false
            }

            //  cloned.tool_calls = []
            return new AIMessageChunk({
                ...cloned
            })
        }

        return cloned
    }

    private _diffToolCallChunks(
        baseToolCallChunks: ToolCallChunk[],
        additionalToolCallChunks: ToolCallChunk[]
    ) {
        const cloned: ToolCallChunk[] = []
        for (let i = 0; i < additionalToolCallChunks.length; i++) {
            const baseToolCall = baseToolCallChunks?.[i]
            const additionalToolCall = additionalToolCallChunks[i]

            if (baseToolCall == null) {
                cloned.push(additionalToolCall)
            } else {
                cloned.push(
                    this._diffToolCallChunk(baseToolCall, additionalToolCall)
                )
            }
        }

        return cloned
    }

    private _diffToolCallChunk(
        baseToolCall: ToolCallChunk,
        additionalToolCall: ToolCallChunk
    ) {
        const cloned: ToolCallChunk = {
            ...baseToolCall
        }

        if (additionalToolCall.name !== baseToolCall.name) {
            cloned.name = additionalToolCall.name.slice(
                baseToolCall.name?.length ?? 0
            )
        } else {
            cloned.name = undefined
        }

        if (additionalToolCall.id !== baseToolCall.id) {
            cloned.id = additionalToolCall.id.slice(
                baseToolCall.id?.length ?? 0
            )

            if (cloned.id === '') {
                cloned.id = undefined
            }
        } else {
            cloned.id = ''
        }

        if (additionalToolCall.args !== baseToolCall.args) {
            cloned.args = additionalToolCall.args.slice(
                baseToolCall.args?.length ?? 0
            )
        } else {
            cloned.args = undefined
        }

        return cloned
    }
}

function cloneMessageChunk(messageChunk: BaseMessageChunk) {
    const content = messageChunk.content
    const additional_kwargs = messageChunk.additional_kwargs
    const name = messageChunk.name

    if (messageChunk instanceof AIMessageChunk) {
        return new AIMessageChunk({
            content,
            additional_kwargs,
            name,
            tool_call_chunks: messageChunk.tool_call_chunks
        })
    } else if (messageChunk instanceof HumanMessageChunk) {
        return new HumanMessageChunk({
            content,
            additional_kwargs,
            name
        })
    } else if (messageChunk instanceof SystemMessageChunk) {
        return new SystemMessageChunk({
            content,
            additional_kwargs,
            name
        })
    } else if (messageChunk instanceof FunctionMessageChunk) {
        return new FunctionMessageChunk({
            content,
            additional_kwargs,
            name
        })
    } else if (messageChunk instanceof ToolMessageChunk) {
        return new ToolMessageChunk({
            content,
            additional_kwargs,
            name,
            tool_call_id: messageChunk.tool_call_id
        })
    } else {
        return new ChatMessageChunk({
            content,
            additional_kwargs,
            name,
            role: messageChunk._getType()
        })
    }
}
