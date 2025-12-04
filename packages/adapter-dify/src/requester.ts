import {
    AIMessageChunk,
    BaseMessage,
    MessageContent,
    MessageContentImageUrl
} from '@langchain/core/messages'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import { ClientConfigPool } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { Config } from '.'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context } from 'koishi'
import {
    AssistantStreamResponse,
    DifyClientConfig,
    InputFileObject
} from './types'
import { sseIterable } from 'koishi-plugin-chatluna/utils/sse'
import * as fetchType from 'undici/types/fetch'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import {
    getMessageContent,
    isMessageContentImageUrl
} from 'koishi-plugin-chatluna/utils/string'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { File, FormData } from 'undici'

type UploadCandidate = {
    source: string | ArrayBuffer | Uint8Array | Buffer
    type: InputFileObject['type']
    fileName?: string
    mimeType?: string
}

type FilePayload = {
    buffer: Buffer
    fileName: string
    mimeType?: string
}

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
        const lastMessage = params.input[params.input.length - 1] as
            | BaseMessage
            | undefined
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
            inputs: this.buildInputs(params, lastMessage, chatlunaMultimodal),
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
            inputs: this.buildInputs(params, lastMessage, chatlunaMultimodal),
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
        lastMessage?: BaseMessage,
        chatlunaMultimodal?: string
    ): Record<string, unknown> {
        const inputs = {
            input: getMessageContent(lastMessage?.content ?? ''),
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
            chatluna_user_name: params.variables?.['user'],
            chatluna_multimodal: chatlunaMultimodal
        }

        return inputs
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
        const chatlunaMultimodal = this.safeSerializeMultimodal(
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
            return [] as UploadCandidate[]
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
                const imageUrl = (part as MessageContentImageUrl).image_url
                const url =
                    typeof imageUrl === 'string' ? imageUrl : imageUrl?.url

                if (url) {
                    addCandidate(url, 'image')
                }
            }
        }

        const additionalImages = lastMessage.additional_kwargs?.['images']
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
        }

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
        const payload = await this.resolveFilePayload(candidate, signal)

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
                this.mapMimeToFileType(payload.mimeType) ??
                candidate.type ??
                'custom',
            transfer_method: 'local_file',
            upload_file_id: uploadFileId
        }
    }

    private async resolveFilePayload(
        candidate: UploadCandidate,
        signal?: AbortSignal
    ): Promise<FilePayload | null> {
        const { source, fileName, mimeType } = candidate

        if (typeof source === 'string') {
            const dataUrlPayload = this.tryParseDataUrl(
                source,
                fileName,
                mimeType
            )
            if (dataUrlPayload) {
                return dataUrlPayload
            }

            const localFilePayload = await this.tryReadLocalFile(
                source,
                fileName,
                mimeType
            )
            if (localFilePayload) {
                return localFilePayload
            }

            const remoteFilePayload = await this.tryFetchRemoteFile(
                source,
                fileName,
                mimeType,
                signal
            )
            if (remoteFilePayload) {
                return remoteFilePayload
            }

            return null
        }

        const buffer = this.convertToBuffer(source)

        if (!buffer) {
            return null
        }

        return {
            buffer,
            fileName: fileName ?? this.buildFallbackFileName(mimeType),
            mimeType
        }
    }

    private tryParseDataUrl(
        source: string,
        preferredName?: string,
        preferredMime?: string
    ): FilePayload | null {
        const match = source.match(/^data:([^;]+);base64,(.+)$/)
        if (!match) {
            return null
        }

        const mimeType = preferredMime ?? match[1]
        const buffer = Buffer.from(match[2], 'base64')
        const fileName = preferredName ?? this.buildFallbackFileName(mimeType)

        return {
            buffer,
            fileName,
            mimeType
        }
    }

    private async tryReadLocalFile(
        source: string,
        preferredName?: string,
        preferredMime?: string
    ): Promise<FilePayload | null> {
        if (
            source.startsWith('http://') ||
            source.startsWith('https://') ||
            source.startsWith('data:')
        ) {
            return null
        }

        const filePath = source.startsWith('file://')
            ? fileURLToPath(source)
            : source

        if (!existsSync(filePath)) {
            return null
        }

        try {
            const buffer = await readFile(filePath)
            const ext = path.extname(filePath)
            const mimeType = preferredMime ?? this.guessMimeType(ext)
            const rawName = path.basename(filePath)
            const fileName =
                preferredName ??
                (rawName.length > 0
                    ? rawName
                    : this.buildFallbackFileName(mimeType))

            return {
                buffer,
                fileName,
                mimeType
            }
        } catch (error) {
            this.logger.warn(`Failed to read file from ${filePath}`, error)
            return null
        }
    }

    private async tryFetchRemoteFile(
        source: string,
        preferredName?: string,
        preferredMime?: string,
        signal?: AbortSignal
    ): Promise<FilePayload | null> {
        if (!source.startsWith('http://') && !source.startsWith('https://')) {
            return null
        }

        try {
            const response = await this._plugin.fetch(source, {
                method: 'GET',
                signal
            })

            if (!response.ok) {
                this.logger.warn(
                    `Failed to fetch remote file: ${source}, status: ${response.status}`
                )
                return null
            }

            const buffer = Buffer.from(await response.arrayBuffer())
            const contentType = response.headers
                .get('content-type')
                ?.split(';')?.[0]

            let fileName: string

            try {
                const parsedUrl = new URL(source)
                const urlFileName = path.basename(parsedUrl.pathname)
                fileName =
                    preferredName ??
                    (urlFileName.length > 0
                        ? urlFileName
                        : this.buildFallbackFileName(contentType))
            } catch {
                fileName =
                    preferredName ?? this.buildFallbackFileName(contentType)
            }

            return {
                buffer,
                fileName,
                mimeType: preferredMime ?? contentType
            }
        } catch (error) {
            this.logger.warn(`Failed to fetch remote file: ${source}`, error)
            return null
        }
    }

    private convertToBuffer(
        source: ArrayBuffer | Uint8Array | Buffer
    ): Buffer | null {
        if (source instanceof Buffer) {
            return source
        }

        if (source instanceof ArrayBuffer) {
            return Buffer.from(source)
        }

        if (ArrayBuffer.isView(source)) {
            return Buffer.from(
                source.buffer,
                source.byteOffset,
                source.byteLength
            )
        }

        return null
    }

    private mapMimeToFileType(
        mimeType?: string
    ): InputFileObject['type'] | undefined {
        if (!mimeType) {
            return undefined
        }

        if (mimeType.startsWith('image/')) {
            return 'image'
        }

        if (mimeType.startsWith('audio/')) {
            return 'audio'
        }

        if (mimeType.startsWith('video/')) {
            return 'video'
        }

        if (
            mimeType.startsWith('text/') ||
            mimeType === 'application/pdf' ||
            mimeType === 'application/msword' ||
            mimeType ===
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ) {
            return 'document'
        }

        return 'custom'
    }

    private guessMimeType(
        extension?: string,
        fallback: string = 'application/octet-stream'
    ) {
        if (!extension) {
            return fallback
        }

        const normalized = extension.startsWith('.')
            ? extension.substring(1)
            : extension

        switch (normalized.toLowerCase()) {
            case 'png':
                return 'image/png'
            case 'jpg':
            case 'jpeg':
                return 'image/jpeg'
            case 'gif':
                return 'image/gif'
            case 'webp':
                return 'image/webp'
            case 'bmp':
                return 'image/bmp'
            case 'svg':
                return 'image/svg+xml'
            case 'pdf':
                return 'application/pdf'
            case 'txt':
                return 'text/plain'
            case 'md':
                return 'text/markdown'
            case 'mp3':
                return 'audio/mpeg'
            case 'wav':
                return 'audio/wav'
            case 'ogg':
                return 'audio/ogg'
            case 'mp4':
                return 'video/mp4'
            case 'mov':
                return 'video/quicktime'
            default:
                return fallback
        }
    }

    private guessExtensionFromMime(mimeType?: string) {
        if (!mimeType) {
            return 'bin'
        }

        switch (mimeType) {
            case 'image/png':
                return 'png'
            case 'image/jpeg':
                return 'jpg'
            case 'image/gif':
                return 'gif'
            case 'image/webp':
                return 'webp'
            case 'image/svg+xml':
                return 'svg'
            case 'application/pdf':
                return 'pdf'
            case 'text/plain':
                return 'txt'
            case 'text/markdown':
                return 'md'
            case 'audio/mpeg':
                return 'mp3'
            case 'audio/wav':
                return 'wav'
            case 'audio/ogg':
                return 'ogg'
            case 'video/mp4':
                return 'mp4'
            case 'video/quicktime':
                return 'mov'
            default:
                if (mimeType.startsWith('image/')) {
                    return mimeType.split('/')[1] ?? 'img'
                }
                return 'bin'
        }
    }

    private buildFallbackFileName(mimeType?: string) {
        const ext = this.guessExtensionFromMime(mimeType)
        return `chatluna_file.${ext}`
    }

    private safeSerializeMultimodal(
        lastMessage?: BaseMessage,
        candidates: UploadCandidate[] = []
    ): string | undefined {
        if (!lastMessage) {
            return undefined
        }

        try {
            return JSON.stringify(
                {
                    content: lastMessage.content,
                    additional_kwargs: lastMessage.additional_kwargs,
                    extracted: candidates
                },
                (_, value) => {
                    if (value instanceof Buffer) {
                        return value.toString('base64')
                    }

                    if (value instanceof ArrayBuffer) {
                        return Buffer.from(value).toString('base64')
                    }

                    if (ArrayBuffer.isView(value)) {
                        return Buffer.from(
                            value.buffer,
                            value.byteOffset,
                            value.byteLength
                        ).toString('base64')
                    }

                    return value
                }
            )
        } catch (error) {
            this.logger.warn(
                'Failed to serialize chatluna_multimodal payload',
                error
            )
            return undefined
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
