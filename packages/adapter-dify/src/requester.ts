import {
    AIMessageChunk,
    BaseMessage,
    MessageContent
} from '@langchain/core/messages'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { ClientConfigPool } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { Config, logger } from '.'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import {
    AssistantStreamResponse,
    DifyClientConfig,
    FilePayload,
    InputFileObject,
    UploadCandidate
} from './types'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import * as fetchType from 'undici/types/fetch'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import {
    getMessageContent,
    isMessageContentImageUrl,
    isMessageContentText
} from 'koishi-plugin-chatluna/utils/string'
import { File, FormData } from 'undici'
import {
    mapMimeToFileType,
    resolveFilePayload,
    safeSerializeMultimodal
} from './utils'

export class DifyRequester extends ModelRequester<DifyClientConfig> {
    constructor(
        ctx: Context,
        _configPool: ClientConfigPool<DifyClientConfig>,
        public _pluginConfig: Config,
        _plugin: ChatLunaPlugin<DifyClientConfig>
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

        // 为什么需要这么多空判断。。。
        const conversationId =
            params.id ??
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ((params.variables as any)?.built?.conversationId as string) ??
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ((params.variables as any)?.chatluna_conversation_id as string) ??
            this._resolveConversationIdFromMessages(params.input)

        if (!conversationId) {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error(`The dify adapter only support chatluna chat mode.`)
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
            iter = this._workflowStream(params, conversationId, config)
        }

        for await (const chunk of iter) {
            yield chunk
        }
    }

    private _resolveConversationIdFromMessages(
        messages: BaseMessage[] = []
    ): string | undefined {
        for (const message of messages) {
            const conversationId =
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (message as any)?.additional_kwargs?.chatluna_conversation_id ||
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (message as any)?.additional_kwargs?.conversationId ||
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (message as any)?.additional_kwargs?.conversation_id

            if (
                typeof conversationId === 'string' &&
                conversationId.length > 0
            ) {
                return conversationId
            }
        }
        return undefined
    }

    private async *_agentStream(
        params: ModelRequestParams,
        difyConversationId: string,
        input: string,
        conversationId: string,
        config: { apiKey: string; workflowName: string; workflowType: string }
    ): AsyncGenerator<ChatGenerationChunk> {
        const lastMessage = params.input?.[params.input.length - 1]
        const query = getMessageContent(lastMessage?.content ?? input ?? '')
        const difyUser = this.resolveDifyUser(params)
        const { files, chatlunaMultimodal } = await this.prepareFiles(
            params,
            lastMessage,
            difyUser,
            config.apiKey
        )

        const requestBody: {
            query: string
            response_mode: 'streaming'
            inputs: Record<string, unknown>
            user: string
            conversation_id: string
            files?: InputFileObject[]
        } = {
            query,
            response_mode: 'streaming',
            inputs: this.buildInputs(
                params,
                conversationId,
                lastMessage,
                chatlunaMultimodal
            ),
            user: difyUser,
            conversation_id:
                difyConversationId == null ? '' : difyConversationId
        }

        if (files.length > 0) {
            requestBody.files = files
        }

        const response = await this._post(
            '/chat-messages',
            requestBody,
            config.apiKey,
            {
                signal: params.signal
            }
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
        conversationId: string | undefined,
        config: { apiKey: string; workflowName: string; workflowType: string }
    ): AsyncGenerator<ChatGenerationChunk> {
        const lastMessage = params.input[params.input.length - 1] as
            | BaseMessage
            | undefined
        const difyUser = this.resolveDifyUser(params)
        const { files, chatlunaMultimodal } = await this.prepareFiles(
            params,
            lastMessage,
            difyUser,
            config.apiKey
        )

        const requestBody: {
            response_mode: 'streaming'
            inputs: Record<string, unknown>
            user: string
            files?: InputFileObject[]
        } = {
            response_mode: 'streaming',
            inputs: this.buildInputs(
                params,
                conversationId,
                lastMessage,
                chatlunaMultimodal
            ),
            user: difyUser
        }

        if (files.length > 0) {
            requestBody.files = files
        }

        const response = await this._post(
            '/workflows/run',
            requestBody,
            config.apiKey,
            {
                signal: params.signal
            }
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

    private buildInputs(
        params: ModelRequestParams,
        conversationId: string | undefined,
        lastMessage?: BaseMessage,
        chatlunaMultimodal?: string
    ): Record<string, unknown> {
        const inputs = {
            input: getMessageContent(lastMessage?.content ?? ''),
            chatluna_history: this.buildChatlunaHistory(params.input ?? []),
            chatluna_conversation_id: conversationId,
            ...Object.keys(params.variables ?? {}).reduce((acc, key) => {
                acc[`chatluna_${key}`] = params.variables?.[key]
                return acc
            }, {}),
            chatluna_user_id: params.variables?.['user_id'],
            chatluna_bot_id: params.variables?.['bot_id'],
            chatluna_group_id: params.variables?.['group_id'],
            chatluna_user_name: params.variables?.['user'],
            chatluna_multimodal: chatlunaMultimodal
        }

        return inputs
    }

    private buildChatlunaHistory(messages: BaseMessage[] = []): string {
        const historyLimit = 130000
        const history: { role: string; content: string }[] = []
        let totalLength = 0

        for (const message of messages) {
            const content = this.extractTextFromMessageContent(message.content)
            if (!content) {
                continue
            }

            const entry = {
                role: message.getType(),
                content
            }

            history.push(entry)
            totalLength += entry.content.length

            while (totalLength > historyLimit) {
                if (history.length === 1) {
                    const truncated = entry.content.slice(-historyLimit)
                    entry.content = truncated
                    totalLength = truncated.length
                    break
                }

                const removed = history.shift()
                if (!removed) {
                    break
                }
                totalLength -= removed.content.length
            }
        }

        return JSON.stringify(history)
    }

    private extractTextFromMessageContent(
        content: BaseMessage['content']
    ): string | undefined {
        if (typeof content === 'string') {
            return content
        }

        if (!content) {
            return undefined
        }

        const parts: string[] = []
        for (const part of content) {
            if (isMessageContentText(part)) {
                parts.push(part.text)
            }
        }

        return parts.length > 0 ? parts.join('') : undefined
    }

    private resolveDifyUser(params: ModelRequestParams): string {
        return (
            (params.variables?.['user_id'] as string) ||
            (params.variables?.['user'] as string) ||
            'chatluna'
        )
    }

    private async prepareFiles(
        params: ModelRequestParams,
        lastMessage: BaseMessage | undefined,
        difyUser: string,
        apiKey: string
    ): Promise<{
        files: InputFileObject[]
        chatlunaMultimodal?: string
    }> {
        const candidates = this.extractUploadCandidates(lastMessage)
        const chatlunaMultimodal = safeSerializeMultimodal(
            lastMessage,
            candidates
        )

        if (
            this._pluginConfig.enableFileUpload === false ||
            candidates.length === 0
        ) {
            return {
                files: [] as InputFileObject[],
                chatlunaMultimodal
            }
        }

        const files = await this.uploadCandidates(
            candidates,
            difyUser,
            apiKey,
            params.signal
        )

        return {
            files,
            chatlunaMultimodal
        }
    }

    private extractUploadCandidates(
        lastMessage?: BaseMessage
    ): UploadCandidate[] {
        if (!lastMessage) {
            return []
        }

        const candidates: UploadCandidate[] = []
        const seen = new Set<string>()

        const addCandidate = (
            source: UploadCandidate['source'],
            type: UploadCandidate['type']
        ) => {
            const key =
                typeof source === 'string' ? `${type}:${source}` : undefined
            if (key && seen.has(key)) {
                return
            }
            if (key) {
                seen.add(key)
            }
            candidates.push({ source, type })
        }

        const content = lastMessage.content as MessageContent
        if (Array.isArray(content)) {
            for (const part of content) {
                if (!isMessageContentImageUrl(part)) {
                    continue
                }
                const imageUrl = part.image_url
                const url =
                    typeof imageUrl === 'string' ? imageUrl : imageUrl?.url

                if (url) {
                    addCandidate(url, 'image')
                }
            }
        }

        /* const additionalImages = lastMessage.additional_kwargs?.['images']
        if (Array.isArray(additionalImages)) {
            for (const image of additionalImages) {
                if (typeof image === 'string') {
                    addCandidate(image, 'image')
                } else if (
                    image instanceof Buffer ||
                    image instanceof ArrayBuffer ||
                    ArrayBuffer.isView(image)
                ) {
                    addCandidate(
                        image as Buffer | ArrayBuffer | Uint8Array,
                        'image'
                    )
                }
            }
        } */

        return candidates
    }

    private async uploadCandidates(
        candidates: UploadCandidate[],
        difyUser: string,
        apiKey: string,
        signal?: AbortSignal
    ): Promise<InputFileObject[]> {
        const files: InputFileObject[] = []

        for (const candidate of candidates) {
            const displayName =
                candidate.fileName ??
                (typeof candidate.source === 'string'
                    ? candidate.source
                    : (candidate.type ?? 'file'))
            try {
                const file = await this.multimodalToDifyFile(
                    candidate,
                    difyUser,
                    apiKey,
                    signal
                )
                if (file) {
                    files.push(file)
                } else {
                    this.logger.info(
                        `Dify upload skipped for ${displayName}, continuing without attaching this file.`
                    )
                }
            } catch (error) {
                this.logger.warn(
                    `Failed to upload multimodal element ${displayName}`,
                    error
                )
            }
        }

        return files
    }

    private async multimodalToDifyFile(
        candidate: UploadCandidate,
        difyUser: string,
        apiKey: string,
        signal?: AbortSignal
    ): Promise<InputFileObject | null> {
        const payload = await resolveFilePayload(
            this._plugin,
            candidate,
            signal
        )

        if (!payload) {
            this.logger.warn('Skip unsupported multimodal element.')
            return null
        }

        const uploadFileId = await this.uploadFileToDify(
            payload,
            difyUser,
            apiKey,
            signal
        )

        if (!uploadFileId) {
            return null
        }

        return {
            type:
                mapMimeToFileType(payload.mimeType) ??
                candidate.type ??
                'custom',
            transfer_method: 'local_file',
            upload_file_id: uploadFileId
        }
    }

    private async uploadFileToDify(
        file: FilePayload,
        difyUser: string,
        apiKey: string,
        signal?: AbortSignal
    ): Promise<string | null> {
        try {
            const formData = new FormData()
            const mimeType = file.mimeType ?? 'application/octet-stream'
            formData.set(
                'file',
                new File([file.buffer], file.fileName, { type: mimeType })
            )
            formData.set('user', difyUser)

            const response = await this._plugin.fetch(
                this.concatUrl('/files/upload'),
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${apiKey}`
                    },
                    body: formData,
                    signal
                }
            )

            if (!response.ok) {
                this.logger.warn(
                    `Failed to upload file to dify: ${response.status} ${response.statusText}`
                )
                return null
            }

            const result = (await response
                .json()
                .catch(async () => await response.text())) as unknown

            const uploadFileId =
                typeof result === 'object' && result != null
                    ? ((result as { data?: { id?: string }; id?: string }).data
                          ?.id ?? (result as { id?: string }).id)
                    : undefined

            if (!uploadFileId) {
                this.logger.warn(
                    'Upload succeeded but no upload_file_id returned.'
                )
                return null
            }

            return uploadFileId
        } catch (error) {
            this.logger.warn('Error when uploading file to dify', error)
            return null
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

        for (const key in data) {
            if (data[key] === undefined) {
                delete data[key]
            }
        }

        if (data.inputs && typeof data.inputs === 'object') {
            for (const key in data.inputs) {
                if (data.inputs[key] === undefined) {
                    delete data.inputs[key]
                }
            }
        }

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
                    method: 'DELETE',
                    body: JSON.stringify({ user: 'chatluna' })
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
        return logger
    }
}
