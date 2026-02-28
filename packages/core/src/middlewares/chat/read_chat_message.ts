import { Context, h, Session } from 'koishi'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { Config } from '../../config'
import { logger } from '../../index'
import type {} from '@initencounter/sst'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'
import {
    getImageType,
    getMessageContent,
    getMimeTypeFromSource,
    hashString
} from 'koishi-plugin-chatluna/utils/string'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type { FileHandlingConfig } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type {} from 'koishi-plugin-chatluna-storage-service'
import { Message } from 'koishi-plugin-chatluna'
import { MessageContent, MessageContentComplex } from '@langchain/core/messages'
import {
    isForwardMessageElement,
    pickForwardMessageId
} from 'koishi-plugin-chatluna/utils/koishi'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { getBase64EncodedSize } from 'koishi-plugin-chatluna/utils/base64'

const CHATLUNA_DOWNLOAD_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const INVALID_RESPONSE_MIME_TYPES = new Set([
    'application/octet-stream',
    'binary/octet-stream',
    'application/x-binary',
    'application/x-msdownload'
])

// Supported audio MIME types that don't require ffmpeg conversion
const SUPPORTED_AUDIO_MIME_TYPES = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/aac',
    'audio/flac',
    'audio/wav',
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/aiff'
])

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('read_chat_message', async (session, context) => {
            let message =
                context.command != null ? context.message : session.elements

            if (typeof message === 'string') {
                message = [h.text(message)]
            }

            const room = context.options.room

            const transformedMessage =
                await ctx.chatluna.messageTransformer.transform(
                    session,
                    message as h[],
                    room?.model ?? '',
                    undefined,
                    {
                        quote: false,
                        includeQuoteReply: config.includeQuoteReply
                    }
                )

            if (config.attachForwardMsgIdToContext) {
                const kwargs = transformedMessage.additional_kwargs
                const state = kwargs?.[forwardHistoryInternalKey] as
                    | ForwardHistoryState
                    | undefined

                if (state?.hasForwardHistory) {
                    if (state.ids.length > 0) {
                        transformedMessage.additional_kwargs!.forwardMessageIds =
                            state.ids
                    }
                    addMessageContent(transformedMessage, '[聊天记录]')
                }

                // Internal-only state, should not leak outside this middleware.
                delete kwargs?.[forwardHistoryInternalKey]
            }

            if (
                transformedMessage.content.length < 1 &&
                getMessageContent(transformedMessage.content).trim().length < 1
            ) {
                return ChainMiddlewareRunStatus.STOP
            }

            context.options.inputMessage = transformedMessage

            return ChainMiddlewareRunStatus.CONTINUE
        })

        .after('resolve_room')

    ctx.chatluna.messageTransformer.intercept(
        'text',
        async (session, element, message) => {
            addMessageContent(message, element.attrs['content'])
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'at',
        async (session, element, message) => {
            const name = element.attrs['name']
            const id = element.attrs['id']

            if (id !== session.bot.selfId) {
                addMessageContent(
                    message,
                    `<at ${name != null ? `name="${name}"` : ''} id="${id}"/>`
                )
            }
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'forward',
        async (session, element, message) => {
            if (!config.attachForwardMsgIdToContext) return
            trackForwardId(element, message)
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'message',
        async (session, element, message) => {
            if (!config.attachForwardMsgIdToContext) return
            if (!isForwardMessageElement(element)) return
            trackForwardId(element, message)
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'face',
        async (session, element, message) => {
            addMessageContent(
                message,
                `[face:${element.attrs.id}:${element.attrs.name}]`
            )
            return true
        }
    )

    // #region img handler

    ctx.chatluna.messageTransformer.intercept(
        'img',
        async (session, element, message, model) => {
            const parsedModelInfo =
                model != null
                    ? ctx.chatluna.platform.findModel(model)
                    : undefined

            const isInstalledImageService =
                ctx.chatluna.getPlugin('chatluna-multimodal-service') != null

            if (
                parsedModelInfo?.value != null &&
                !parsedModelInfo.value.capabilities.includes(
                    ModelCapabilities.ImageInput
                )
            ) {
                if (!isInstalledImageService) {
                    logger.warn(
                        `Model "${model}" does not support image input. Please use a model that supports vision capabilities, or install chatluna-multimodal-service plugin to enable image description.`
                    )
                }
                return false
            }

            const url = (element.attrs.url ?? element.attrs.src) as string
            const displayUrl =
                url.length > 100 ? url.substring(0, 100) + '...' : url
            logger.debug(`Processing image: ${displayUrl}`)

            if (!ctx.chatluna_storage) {
                return await oldImageRead(
                    ctx,
                    url,
                    message,
                    element,
                    isInstalledImageService
                )
            }

            const { buffer, ext } = await readImage(ctx, url)

            if (ext == null) {
                return false
            }

            // For GIF images, warn and let image-service handle it
            if (ext === 'image/gif') {
                if (!isInstalledImageService) {
                    logger.warn(
                        `Detected GIF image, which is not supported by most models. Please install chatluna-image-service plugin to parse GIF animations.`
                    )
                }
                return false
            }

            const fileExt = ext.includes('/') ? ext.split('/')[1] : ext
            element.attrs['ext'] = fileExt

            let fileName = element.attrs['filename']
            if (fileName == null || fileName.length > 50) {
                fileName = `${await hashString(url, 8)}.${fileExt}`
            }

            logger.debug(`Saving image as temp file: ${fileName}`)

            const tempFile = await ctx.chatluna_storage.createTempFile(
                buffer,
                fileName
            )

            ensureContentArray(message, `[image:${tempFile.url}]`)
            ;(message.content as MessageContentComplex[]).push({
                type: 'image_url',
                image_url: { url: tempFile.url }
            })
            element.attrs['imageUrl'] = tempFile.url
        },
        -100
    )

    // #endregion

    // #region sst audio fallback

    ctx.inject(['sst'], (ctx) => {
        logger.debug('sst service loaded.')

        ctx.effect(
            () =>
                ctx.chatluna.messageTransformer.intercept(
                    'audio',
                    async (session, element, message, model) => {
                        const modelInfo =
                            model != null
                                ? ctx.chatluna.platform.findModel(model)
                                : undefined

                        if (isAudioHandled(message, element)) {
                            logger.debug(
                                'Skip sst audio2text because audio is already handled.'
                            )
                            return false
                        }

                        // If the model supports audio input natively, skip sst
                        if (
                            modelInfo?.value?.capabilities?.includes(
                                ModelCapabilities.AudioInput
                            )
                        ) {
                            logger.debug(
                                'Skip sst audio2text because model supports audio input natively.'
                            )
                            return false
                        }

                        const content = await ctx.sst.audio2text(session)
                        logger.debug(`audio2text: ${content}`)
                        addMessageContent(message, content)
                        markAudioHandled(message, element)
                    }
                ),
            -100
        )
    })

    // #endregion

    // #region file/video/audio handler

    ctx.chatluna.messageTransformer.intercept(
        'file',
        async (session, element, message, model) => {
            const modelInfo =
                model != null
                    ? ctx.chatluna.platform.findModel(model)
                    : undefined

            if (
                modelInfo?.value != null &&
                !modelInfo.value.capabilities.includes(
                    ModelCapabilities.FileInput
                )
            ) {
                addMessageContent(
                    message,
                    `[file: ${element.attrs['file'] ?? element.attrs['filename'] ?? 'attachment'} (skipped: model does not support file input)]`
                )
                return
            }

            await handleFileElement(
                ctx,
                session,
                element,
                message,
                model,
                'file'
            )
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'video',
        async (session, element, message, model) => {
            const modelInfo =
                model != null
                    ? ctx.chatluna.platform.findModel(model)
                    : undefined

            if (
                modelInfo?.value != null &&
                !modelInfo.value.capabilities.includes(
                    ModelCapabilities.VideoInput
                )
            ) {
                addMessageContent(
                    message,
                    `[video: ${element.attrs['file'] ?? element.attrs['filename'] ?? 'attachment'} (skipped: model does not support video input)]`
                )
                return
            }

            await handleFileElement(
                ctx,
                session,
                element,
                message,
                model,
                'video'
            )
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'audio',
        async (session, element, message, model) => {
            if (isAudioHandled(message, element)) {
                logger.debug(
                    'Skip audio file handler because audio is already handled.'
                )
                return false
            }

            const modelInfo =
                model != null
                    ? ctx.chatluna.platform.findModel(model)
                    : undefined

            // If model doesn't support audio input, skip (sst handles fallback)
            if (
                modelInfo?.value != null &&
                !modelInfo.value.capabilities.includes(
                    ModelCapabilities.AudioInput
                )
            ) {
                return false
            }

            const handled = await handleFileElement(
                ctx,
                session,
                element,
                message,
                model,
                'audio'
            )

            if (handled) {
                markAudioHandled(message, element)
            }

            return false
        }
    )

    // #endregion
}

// #region helper: get platform client file config

async function getFileConfig(
    ctx: Context,
    model?: string
): Promise<FileHandlingConfig | null> {
    if (model == null) return null

    const [platform] = parseRawModelName(model)
    if (!platform) return null

    try {
        const clientRef = await ctx.chatluna.platform.getClient(platform)
        return clientRef?.value?.getFileHandlingConfig() ?? null
    } catch {
        return null
    }
}

// #endregion

// #region helper: resolve source URL

async function resolveSourceUrl(
    ctx: Context,
    session: Session,
    element: h
): Promise<string | null> {
    const srcAttr =
        (element.attrs['src'] as string | undefined) ??
        (element.attrs['url'] as string | undefined)

    if (srcAttr?.startsWith('http')) {
        return srcAttr
    }

    // Platform-specific URL resolution (e.g. onebot file IDs)
    const fileId = element.attrs['fileId'] ?? element.attrs['fileid']
    if (session.platform === 'onebot' && fileId) {
        try {
            const bot = session.bot as OneBotBot<Context>
            const busId = element.attrs['busId'] ?? element.attrs['busid']

            let fileUrl: string | undefined
            if (session.isDirect) {
                fileUrl = await bot.internal.getPrivateFileUrl(
                    session.userId,
                    fileId
                )
            } else {
                fileUrl = await bot.internal.getGroupFileUrl(
                    session.guildId,
                    fileId,
                    busId
                )
            }
            if (fileUrl) {
                return fileUrl
            }
        } catch (e) {
            ctx.logger.error(
                `Failed to get source URL for element: ${element.toString()}`,
                e
            )
            // fall through
        }
    }

    if (srcAttr) return srcAttr

    logger.warn(`Failed to get source URL for element: ${element.toString()}`)
    return null
}

// #endregion

// #region handleFileElement

async function handleFileElement(
    ctx: Context,
    session: Session,
    element: h,
    message: Message,
    model: string | undefined,
    elementType: 'file' | 'video' | 'audio'
): Promise<boolean> {
    if (elementType === 'audio' && isAudioHandled(message, element)) {
        logger.debug(
            'Skip handling audio file because audio is already handled.'
        )
        return false
    }

    const fileName: string =
        element.attrs['file'] ??
        element.attrs['name'] ??
        element.attrs['filename']

    const sourceUrl = await resolveSourceUrl(ctx, session, element)
    if (!sourceUrl) return false

    const fileConfig = await getFileConfig(ctx, model)

    // Download the file
    let buffer: Buffer
    let responseMimeType: string | null = null
    try {
        const response = await ctx.http(sourceUrl, {
            responseType: 'arraybuffer',
            method: 'get',
            headers: { 'User-Agent': CHATLUNA_DOWNLOAD_USER_AGENT }
        })
        buffer = Buffer.from(response.data)

        const rawCt =
            response?.headers?.['content-type'] ??
            response?.headers?.['Content-Type']
        const ctValue = Array.isArray(rawCt) ? rawCt[0] : rawCt
        const parsedMime =
            typeof ctValue === 'string'
                ? ctValue.split(';')[0].trim().toLowerCase()
                : null
        responseMimeType =
            parsedMime != null && !INVALID_RESPONSE_MIME_TYPES.has(parsedMime)
                ? parsedMime
                : null
    } catch (error) {
        logger.error(`Failed to read file from ${sourceUrl}:`, error)
        return false
    }

    const mimeType =
        responseMimeType ?? getMimeTypeFromSource(sourceUrl, fileName)

    // For audio elements, check if the format is supported natively
    if (elementType === 'audio' && mimeType != null) {
        if (!SUPPORTED_AUDIO_MIME_TYPES.has(mimeType)) {
            const isInstalledMultimodalService =
                ctx.chatluna.getPlugin('multimodal-service') != null
            if (!isInstalledMultimodalService) {
                logger.warn(
                    `Unsupported audio format "${mimeType}". Please install chatluna-multimodal-service plugin to handle this format.`
                )
            }
            return false
        }
    }

    // If the platform has a file handling config, validate and potentially inline
    if (fileConfig) {
        // Check if the MIME type is supported by the platform
        if (mimeType != null && !fileConfig.supportedMimeTypes.has(mimeType)) {
            addMessageContent(
                message,
                `[${elementType}: ${fileName ?? 'attachment'} (skipped: unsupported MIME type "${mimeType}")]`
            )
            return false
        }

        // Check file size limits
        const _maxSizeMb = parseFloat(
            element.attrs['chatluna_multimodal_file_input_max_size_mb']
        )
        const maxSize =
            Number.isFinite(_maxSizeMb) && _maxSizeMb > 0
                ? _maxSizeMb * 1024 * 1024
                : ((mimeType != null
                      ? fileConfig.maxFileSizeBytesOverrides?.[mimeType]
                      : undefined) ?? fileConfig.maxFileSizeBytes)
        const encodedSize = getBase64EncodedSize(buffer.byteLength)

        if (encodedSize > maxSize) {
            addMessageContent(
                message,
                `[${elementType}: ${fileName ?? 'attachment'} (skipped: file size ${encodedSize} bytes exceeds limit ${maxSize} bytes)]`
            )
            return false
        }

        // Check total size across all inline files
        const currentTotal = getFileTotalSize(message)
        const newTotal = currentTotal + encodedSize

        if (newTotal > fileConfig.maxTotalSizeBytes) {
            addMessageContent(
                message,
                `[${elementType}: ${fileName ?? 'attachment'} (skipped: total inline size would exceed limit)]`
            )
            return false
        }
    }

    // Default path: store in storage (url) or fallback to base64 inline
    const resolvedFileName = fileName ?? 'attachment'
    element.attrs['file'] = resolvedFileName
    element.attrs['filename'] = resolvedFileName
    element.attrs['chatluna_file_url'] = sourceUrl

    const label =
        elementType === 'audio'
            ? 'Voice'
            : elementType === 'video'
              ? 'Video'
              : 'File'

    let fileUrl: string
    if (ctx.chatluna_storage) {
        const file = await ctx.chatluna_storage.createTempFile(
            buffer,
            resolvedFileName
        )
        const displayFileName = fileName ?? file.name
        element.attrs['file'] = displayFileName
        element.attrs['filename'] = displayFileName
        element.attrs['chatluna_file_url'] = file.url
        fileUrl = file.url
        ensureContentArray(message, `[${label}:${displayFileName}]`)
    } else {
        // No storage service — inline as base64 data URL, same as oldImageRead
        const base64 = buffer.toString('base64')
        fileUrl = `data:${mimeType ?? 'application/octet-stream'};base64,${base64}`
        ensureContentArray(message, `[${label}:${resolvedFileName}]`)
    }

    // Add typed content part alongside text
    pushTypedContent(message, elementType, fileUrl, mimeType)
    return true
}

// #endregion

// #region image reading

async function oldImageRead(
    ctx: Context,
    url: string,
    message: Message,
    element: h,
    isInstalledImageService: boolean
) {
    const imageHash = await hashString(url, 8)
    element.attrs['imageHash'] = imageHash

    try {
        const { base64Source, ext } = await readImage(ctx, url)

        if (ext == null) {
            return false
        }

        if (ext === 'image/gif') {
            if (!isInstalledImageService) {
                logger.warn(
                    `Detected GIF image, which is not supported by most models. Please install chatluna-image-service plugin to parse GIF animations.`
                )
            }
            return false
        }

        ensureContentArray(message, `[image:${imageHash}]`)
        ;(message.content as MessageContentComplex[]).push({
            type: 'image_url',
            image_url: { url: base64Source, hash: imageHash }
        } as unknown as MessageContentComplex)
    } catch (error) {
        const displayUrl =
            url.length > 100 ? url.substring(0, 100) + '...' : url
        logger.warn(
            `Failed to read image from ${displayUrl}. Please check your Koishi chat adapter.`,
            error
        )
    }
}

async function readImage(ctx: Context, url: string) {
    if (url.startsWith('data:image') && url.includes('base64')) {
        const buffer = Buffer.from(url.split(',')[1], 'base64')
        const ext = getImageType(buffer)

        return {
            base64Source: url,
            buffer,
            ext
        }
    }

    try {
        const response = await ctx.http(url, {
            responseType: 'arraybuffer',
            method: 'get',
            headers: { 'User-Agent': CHATLUNA_DOWNLOAD_USER_AGENT }
        })

        const buffer = Buffer.from(response.data)
        const base64 = buffer.toString('base64')
        const ext = getImageType(buffer)

        return {
            base64Source: `data:${ext};base64,${base64}`,
            buffer,
            ext
        }
    } catch (error) {
        logger.error(`Failed to read image from ${url}:`, error)
        return {
            base64Source: null,
            buffer: null,
            ext: null
        }
    }
}

// #endregion

// #region content helpers

function pushTypedContent(
    message: Message,
    elementType: 'file' | 'video' | 'audio',
    url: string,
    mimeType: string | null
) {
    if (elementType === 'audio') {
        ;(message.content as MessageContentComplex[]).push({
            type: 'audio_url',
            audio_url: { url, mimeType: mimeType ?? '' }
        } as unknown as MessageContentComplex)
    } else if (elementType === 'video') {
        ;(message.content as MessageContentComplex[]).push({
            type: 'video_url',
            video_url: { url, mimeType: mimeType ?? '' }
        } as unknown as MessageContentComplex)
    } else {
        ;(message.content as MessageContentComplex[]).push({
            type: 'file_url',
            file_url: { url, mimeType: mimeType ?? '' }
        } as unknown as MessageContentComplex)
    }
}

function getFileTotalSize(message: Message): number {
    const kwargs = (message.additional_kwargs ?? {}) as Record<string, unknown>
    const value = kwargs['__file_total_size']
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function ensureContentArray(message: Message, fallbackText: string) {
    if (typeof message.content === 'string') {
        message.content = [
            {
                type: 'text',
                text:
                    message.content.trim().length < 1
                        ? fallbackText
                        : message.content
            }
        ]
    }
}

function isAudioHandled(_message: Message, element: h): boolean {
    return element.attrs['_audioHandled'] === true
}

function markAudioHandled(_message: Message, element: h) {
    element.attrs['_audioHandled'] = true
}

function addMessageContent(message: Message, content: MessageContent) {
    if (typeof message.content === 'string' && typeof content === 'string') {
        message.content += content
        return
    }

    message.content = [
        ...(typeof message.content === 'string'
            ? [{ type: 'text', text: message.content }]
            : message.content),
        ...(typeof content === 'string'
            ? [{ type: 'text', text: content }]
            : content)
    ]
}

// #endregion

// #region forward message tracking

const forwardHistoryInternalKey = '__chatluna_forwardHistory'

function trackForwardId(element: h, message: Message) {
    const kwargs = (message.additional_kwargs ??= {})
    const state = (kwargs[forwardHistoryInternalKey] ??= {
        ids: [],
        hasForwardHistory: false
    }) as ForwardHistoryState

    state.hasForwardHistory = true

    const id = pickForwardMessageId(element)
    if (id && !state.ids.includes(id)) {
        state.ids.push(id)
    }
}

interface ForwardHistoryState {
    ids: string[]
    hasForwardHistory: boolean
}

// #endregion

declare module '../../chains/chain' {
    export interface ChainMiddlewareName {
        read_chat_message: string
    }
}
