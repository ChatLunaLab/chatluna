import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { ClientConfigPool } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { Config } from '.'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import { AssistantStreamResponse, DifyClientConfig } from './types'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import * as fetchType from 'undici/types/fetch'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { AIMessageChunk } from '@langchain/core/messages'

export class DifyRequester extends ModelRequester<DifyClientConfig> {
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<DifyClientConfig>,
        public _pluginConfig: Config,
        _plugin: ChatLunaPlugin
    ) {
        super(ctx, _configPool, _pluginConfig, _plugin)
    }

    async *completionStreamInternal(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {
        const config = this._config.value.additionalModel.get(params.model)

        if (!config) {
            throw new ChatLunaError(
                ChatLunaErrorCode.MODEL_NOT_FOUND,
                new Error(`Dify model not found: ${params.model}`)
            )
        }
        const conversationId = params.id

        if (!conversationId) {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error(`The dify adapter only support chatluna room mode.`)
            )
        }

        const difyConversationId = await this.getDifyConversationId(
            conversationId,
            config
        )

        let iter: ReturnType<typeof this._agentStream>

        if (config.workflowType !== 'Workflow') {
            iter = this._agentStream(
                params,
                difyConversationId,
                params.input[params.input.length - 1].content as string,
                conversationId,
                config
            )
        } else {
            iter = this._workflowStream(params, config)
        }

        for await (const chunk of iter) {
            yield chunk
        }
    }

    private async *_agentStream(
        params: ModelRequestParams,
        difyConversationId: string,
        input: string,
        conversationId: string,
        config: { apiKey: string; workflowName: string; workflowType: string }
    ): AsyncGenerator<ChatGenerationChunk> {
        const response = await this._post(
            '/chat-messages',
            {
                query: input,
                response_mode: 'streaming',
                inputs: {
                    input: params.input[params.input.length - 1]
                        .content as string,
                    chatluna_history: JSON.stringify(
                        params.input.map((it) => {
                            return {
                                role: it.getType(),
                                content: it.content
                            }
                        })
                    ),
                    chatluna_conversation_id: params.id,
                    chatluna_user_id: params.variables?.['user_id'],
                    chatluna_bot_id: params.variables?.['bot_id'],
                    chatluna_group_id: params.variables?.['group_id'],
                    chatluna_user_name: params.variables?.['user']
                },
                user: 'chatluna',
                conversation_id:
                    difyConversationId == null ? '' : difyConversationId
            },
            config.apiKey
        )

        const iterator = sseIterable(response)
        let updatedDifyConversationId: string | undefined

        for await (const event of iterator) {
            const chunk = event.data

            if (chunk == null) {
                continue
            }

            let data: AssistantStreamResponse

            try {
                data = JSON.parse(chunk)
            } catch (err) {
                this.ctx.logger.error(
                    'error when parsing dify stream response, Result:' + chunk
                )
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error(
                        'error when calling dify completion, Result: ' + chunk
                    )
                )
            }

            if (data.event === 'error') {
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error(
                        'error when calling dify completion, Result:' + chunk
                    )
                )
            }

            const content = data.answer

            if (content != null) {
                const messageChunk = new AIMessageChunk(content)
                const generationChunk = new ChatGenerationChunk({
                    message: messageChunk,
                    text: content
                })

                yield generationChunk
            }

            updatedDifyConversationId = data.conversation_id

            if (data.event === 'message_end') {
                await this.updateDifyConversationId(
                    conversationId,
                    config.workflowName,
                    updatedDifyConversationId
                )
                break
            }
        }
    }

    private async *_workflowStream(
        params: ModelRequestParams,
        config: { apiKey: string; workflowName: string; workflowType: string }
    ): AsyncGenerator<ChatGenerationChunk> {
        const response = await this._post(
            '/workflows/run',
            {
                response_mode: 'streaming',
                inputs: {
                    input: params.input[params.input.length - 1]
                        .content as string,
                    chatluna_history: JSON.stringify(
                        params.input.map((it) => {
                            return {
                                role: it.getType(),
                                content: it.content
                            }
                        })
                    ),
                    chatluna_conversation_id: params.id,
                    chatluna_user_id: params.variables?.['user_id'],
                    chatluna_bot_id: params.variables?.['bot_id'],
                    chatluna_group_id: params.variables?.['group_id'],
                    chatluna_user_name: params.variables?.['user']
                },
                user: 'chatluna'
            },
            config.apiKey
        )

        const iterator = sseIterable(response)

        for await (const event of iterator) {
            const chunk = event.data

            if (chunk == null) {
                continue
            }

            let data: AssistantStreamResponse

            try {
                data = JSON.parse(chunk)
            } catch (err) {
                this.ctx.logger.error(
                    'error when parsing dify stream response, Result:' + chunk
                )
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error(
                        'error when calling qwen completion, Result: ' + chunk
                    )
                )
            }

            if (data.event === 'error') {
                throw new ChatLunaError(
                    ChatLunaErrorCode.API_REQUEST_FAILED,
                    new Error(
                        'error when calling dify completion, Result:' + chunk
                    )
                )
            }

            const content = data.answer

            if (content != null) {
                const messageChunk = new AIMessageChunk(content)
                const generationChunk = new ChatGenerationChunk({
                    message: messageChunk,
                    text: content
                })

                yield generationChunk
            }
        }
    }

    private async getDifyConversationId(
        conversationId: string,
        config: { apiKey: string; workflowName: string; workflowType: string }
    ) {
        return this.ctx.chatluna.cache.get(
            'chatluna/keys',
            'dify/' + conversationId + '/' + config.workflowName
        )
    }

    private async updateDifyConversationId(
        conversationId: string,
        workflowName: string,
        difyConversationId: string
    ) {
        return this.ctx.chatluna.cache.set(
            'chatluna/keys',
            'dify/' + conversationId + '/' + workflowName,
            difyConversationId
        )
    }

    private _post(
        url: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: any,
        apiKey: string,
        params: fetchType.RequestInit = {}
    ) {
        const requestUrl = this.concatUrl(url)

        const body = JSON.stringify(data)

        return this._plugin.fetch(requestUrl, {
            body,
            headers: this._buildHeaders(apiKey),
            method: 'POST',
            ...params
        })
    }

    private _buildHeaders(apiKey: string) {
        return {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }
    }

    concatUrl(url: string): string {
        return this._pluginConfig.apiURL + url
    }

    async dispose(model?: string, id?: string): Promise<void> {
        if (id == null || model == null) {
            this.ctx.logger.warn('Dify clear: model or id is null')
            return
        }
        const conversationId = id
        const config = this._config.value.additionalModel.get(model)
        const difyConversationId = await this.getDifyConversationId(
            conversationId,
            config
        )

        if (difyConversationId) {
            await this._plugin
                .fetch(this.concatUrl('/conversations/' + difyConversationId), {
                    headers: this._buildHeaders(config.apiKey),
                    method: 'DELETE'
                })
                .then(async (res) => {
                    if (res.ok) {
                        this.ctx.logger.info('Dify clear: success')
                    } else {
                        this.ctx.logger.warn(
                            'Dify clear: failed: ' + (await res.text())
                        )
                    }
                })

            await this.ctx.chatluna.cache.delete(
                'chatluna/keys',
                'dify/' + conversationId + '/' + config.workflowName
            )
        }
    }

    get logger() {
        return this.ctx.logger('chatluna-dify-adapter')
    }
}
