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
import type { QQ } from '@koishijs/plugin-adapter-qq'
import { parsePresetLaneInput } from '../../utils/message_content'

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
    const forwardHistory = new WeakMap<Message, ForwardHistoryState>()
    const fileSizes = new WeakMap<Message, number>()
    const handledAudio = new WeakSet<h>()

    chain
        .middleware('read_chat_message', async (session, context) => {
            let message =
                context.command != null ? context.message : session.elements

            if (typeof message === 'string') {
                message = [h.text(message)]
            }

            if (context.command == null) {
                const text = h.select(message as h[], 'text').join('')
                const parsed = parsePresetLaneInput(
                    text,
                    ctx.chatluna.preset
                        .getAllPreset(true)
                        .value.flatMap((entry) =>
                            entry.split(',').map((item) => item.trim())
                        )
                )

                if (parsed?.preset != null) {
                    const preset = ctx.chatluna.preset.getPreset(
                        parsed.preset,
                        false
                    ).value

                    if (preset != null) {
                        context.options.presetLane = parsed.preset

                        if (
                            parsed.queryOnly &&
                            (message as h[]).every(
                                (element) => element.type === 'text'
                            )
                        ) {
                            context.command = 'conversation_current'
                            context.options.conversation_manage = {
                                ...context.options.conversation_manage,
                                presetLane: parsed.preset
                            }
                            context.message = null
                            return ChainMiddlewareRunStatus.CONTINUE
                        }

                        let skip = text.length - (parsed.content?.length ?? 0)
                        const next: h[] = []

                        for (const element of message as h[]) {
                            if (element.type !== 'text') {
                                next.push(element)
                                continue
                            }

                            const content = String(element.attrs.content ?? '')
                            if (skip >= content.length) {
                                skip -= content.length
                                continue
                            }

                            next.push(
                                h('text', {
                                    ...element.attrs,
                                    content: content.slice(skip)
                                })
                            )
                            skip = 0
                        }

                        message = next
                    }
                }
            }

            context.options.chatMessage = message as h[]

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('lifecycle-prepare')
        .before('resolve_conversation')

    chain
        .middleware('transform_chat_message', async (session, context) => {
            const message = context.options.chatMessage
            const resolved = context.options.conversation

            if (message == null || resolved == null) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            const transformedMessage =
                await ctx.chatluna.messageTransformer.transform(
                    session,
                    message,
                    ctx.chatluna.conversation.pickModel(
                        resolved.constraint,
                        resolved.conversation
                    ) ?? '',
                    undefined,
                    {
                        quote: false,
                        includeQuoteReply: config.includeQuoteReply
                    }
                )

            if (config.attachForwardMsgIdToContext) {
                const state = forwardHistory.get(transformedMessage)

                if (state?.hasForwardHistory) {
                    if (state.ids.length > 0) {
                        transformedMessage.additional_kwargs ??= {}
                        transformedMessage.additional_kwargs.forwardMessageIds =
                            state.ids
                    }
                    addMessageContent(transformedMessage, '[聊天记录]')
                }
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
        .after('resolve_conversation')
        .before('message_delay')

    ctx.chatluna.messageTransformer.before(async (session, elements) => {
        appendQQAttachments(session, elements)
    })

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
            trackForwardId(forwardHistory, element, message)
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'message',
        async (session, element, message) => {
            if (!config.attachForwardMsgIdToContext) return
            if (!isForwardMessageElement(element)) return
            trackForwardId(forwardHistory, element, message)
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
            const supportsImage = modelSupportsElement(ctx, model, 'img')

            const isInstalledImageService =
                ctx.chatluna.getPlugin('multimodal-service') != null

            if (!supportsImage) {
                if (!isInstalledImageService) {
                    logger.warn(
                        `Model "${model}" does not support image input. ` +
                            'Please use a model that supports vision capabilities, ' +
                            'or install chatluna-multimodal-service (multimodal-service) plugin to enable image description.'
                    )
                }
            }

            const url = (element.attrs.url ?? element.attrs.src) as string
            const hash = await hashString(url, 8)
            element.attrs['imageHash'] = hash
            const displayUrl =
                url.length > 100 ? url.substring(0, 100) + '...' : url
            logger.debug(`Processing image: ${displayUrl}`)

            const image = await readImage(ctx, url)
            const buffer = image.buffer
            const ext = image.ext

            if (ext == null || buffer == null) {
                return false
            }

            // For GIF images, warn and let multimodal-service handle it
            if (ext === 'image/gif') {
                if (!isInstalledImageService) {
                    logger.warn(
                        'Detected GIF image, which is not supported by most ' +
                            'models. Please install chatluna-multimodal-service ' +
                            '(multimodal-service) plugin to parse GIF animations.'
                    )
                }
                if (ctx.chatluna_storage)
                    setElementUrl(
                        element,
                        (
                            await ctx.chatluna_storage.createTempFile(
                                buffer,
                                `${hash}.gif`
                            )
                        ).url
                    )
                return false
            }

            let fileName = element.attrs['filename']
            if (fileName == null || fileName.length > 50) {
                fileName = `${hash}.${
                    ext.includes('/') ? ext.split('/')[1] : ext
                }`
            }

            element.attrs['ext'] = ext.includes('/') ? ext.split('/')[1] : ext
            logger.debug(`Saving image as temp file: ${fileName}`)

            const tempFile = ctx.chatluna_storage
                ? await ctx.chatluna_storage.createTempFile(buffer, fileName)
                : null
            const imageUrl = tempFile?.url ?? image.base64Source
            const imageText = tempFile?.url ?? hash

            if (tempFile) setElementUrl(element, tempFile.url)

            if (!supportsImage) {
                addTextPart(message, `[image:${imageText}]`)
                return false
            }

            addTextPart(message, `[image:${imageText}]`)
            ;(message.content as MessageContentComplex[]).push({
                type: 'image_url',
                image_url: { url: imageUrl }
            })
            return false
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

                        if (handledAudio.has(element)) {
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
                        handledAudio.add(element)
                        return false
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
            await handleFileElement(
                ctx,
                fileSizes,
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
            await handleFileElement(
                ctx,
                fileSizes,
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
            const handled = await handleFileElement(
                ctx,
                fileSizes,
                session,
                element,
                message,
                model,
                'audio'
            )

            if (handled) {
                handledAudio.add(element)
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
    fileSizes: WeakMap<Message, number>,
    session: Session,
    element: h,
    message: Message,
    model: string | undefined,
    elementType: 'file' | 'video' | 'audio'
): Promise<boolean> {
    const name: string =
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

    const mimeType = responseMimeType ?? getMimeTypeFromSource(sourceUrl, name)
    const fileName = name ?? 'attachment'
    let label: 'file' | 'video' | 'voice'
    switch (elementType) {
        case 'audio':
            label = 'voice'
            break
        case 'video':
            label = 'video'
            break
        default:
            label = 'file'
    }

    const file = ctx.chatluna_storage
        ? await ctx.chatluna_storage.createTempFile(buffer, fileName)
        : null
    const fileUrl = file
        ? file.url
        : `data:${mimeType ?? 'application/octet-stream'};base64,${buffer.toString('base64')}`

    element.attrs['file'] = file?.name ?? fileName
    element.attrs['filename'] = file?.name ?? fileName
    element.attrs['chatluna_file_url'] = file?.url ?? sourceUrl

    addTextPart(message, `[${label}:${file?.name ?? fileName}]`)

    if (!modelSupportsElement(ctx, model, elementType)) {
        logger.warn(
            `Model "${model}" does not support ${label} input. The file was saved and fallback text was kept.`
        )
        return false
    }

    // For audio elements, check if the format is supported natively
    if (elementType === 'audio' && mimeType != null) {
        if (!SUPPORTED_AUDIO_MIME_TYPES.has(mimeType)) {
            const isInstalledMultimodalService =
                ctx.chatluna.getPlugin('multimodal-service') != null
            if (!isInstalledMultimodalService) {
                logger.warn(
                    `Unsupported audio format "${mimeType}". Please install chatluna-multimodal-service (multimodal-service) plugin to handle this format.`
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
                `[${label}: ${file?.name ?? fileName} (skipped: unsupported MIME type "${mimeType}")]`
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
                `[${label}: ${file?.name ?? fileName} (skipped: file size ${encodedSize} bytes exceeds limit ${maxSize} bytes)]`
            )
            return false
        }

        // Check total size across all inline files
        const size = (fileSizes.get(message) ?? 0) + encodedSize

        if (size > fileConfig.maxTotalSizeBytes) {
            addMessageContent(
                message,
                `[${label}: ${file?.name ?? fileName} (skipped: total inline size would exceed limit)]`
            )
            return false
        }

        fileSizes.set(message, size)
        addFileSize(message, size)
    }

    // Add typed content part alongside text
    pushTypedContent(message, elementType, fileUrl, mimeType)
    return true
}

// #endregion

// #region image reading

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

function toContentParts(
    content: MessageContent | null | undefined
): MessageContentComplex[] {
    if (content == null) {
        return []
    }

    if (typeof content === 'string') {
        return content.length > 0 ? [{ type: 'text', text: content }] : []
    }

    return Array.isArray(content)
        ? content
        : [content as unknown as MessageContentComplex]
}

function addTextPart(message: Message, text: string) {
    const parts = toContentParts(message.content)
    message.content = [...parts, { type: 'text', text }]
}

function addFileSize(message: Message, size: number) {
    message.additional_kwargs ??= {}
    message.additional_kwargs['__file_total_size'] = size
}

function addMessageContent(
    message: Message,
    content: MessageContent | null | undefined
) {
    if (typeof message.content === 'string' && typeof content === 'string') {
        message.content += content
        return
    }

    const incomingParts = toContentParts(content)

    if (incomingParts.length < 1) {
        return
    }

    const currentParts = toContentParts(message.content)

    message.content = [...currentParts, ...incomingParts]
}

// #endregion

// #region forward message tracking

function modelSupportsElement(
    ctx: Context,
    model: string | undefined,
    type: 'img' | 'file' | 'video' | 'audio'
) {
    const info = model != null ? ctx.chatluna.platform.findModel(model) : null
    if (info?.value == null) return true

    switch (type) {
        case 'img':
            return info.value.capabilities.includes(
                ModelCapabilities.ImageInput
            )
        case 'audio':
            return info.value.capabilities.includes(
                ModelCapabilities.AudioInput
            )
        case 'video':
            return info.value.capabilities.includes(
                ModelCapabilities.VideoInput
            )
        default:
            return info.value.capabilities.includes(ModelCapabilities.FileInput)
    }
}

function setElementUrl(element: h, url: string) {
    element.attrs['imageUrl'] = url
    element.attrs['src'] = url
    element.attrs['url'] = url
}

function trackForwardId(
    history: WeakMap<Message, ForwardHistoryState>,
    element: h,
    message: Message
) {
    const state = history.get(message) ?? {
        ids: [],
        hasForwardHistory: false
    }

    history.set(message, state)

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

function appendQQAttachments(session: Session, elements: h[]) {
    if (session.platform !== 'qq') {
        return
    }

    const qq = session.qq as QQ.Payload

    // wtf this
    const attachments = qq?.['d']?.attachments
    if (!attachments?.length) {
        return
    }

    for (const attachment of attachments) {
        const type = attachment.content_type
        const src = attachment.url
        const exists = elements.some(
            (element) => element.attrs.src === src || element.attrs.url === src
        )

        if (exists) {
            continue
        }

        if (type === 'file') {
            elements.push(
                h.file(src, {
                    filename: attachment.filename
                })
            )
        } else if (type.startsWith('audio/')) {
            elements.push(
                h.audio(src, {
                    filename: attachment.filename,
                    type,
                    chatluna_file_url: src
                })
            )
        } else if (type === 'voice') {
            elements.push(
                h.audio(src, {
                    filename: attachment.filename,
                    type,
                    chatluna_file_url: src
                })
            )
        } else if (type.startsWith('video/')) {
            elements.push(
                h.video(src, {
                    filename: attachment.filename,
                    width: attachment.width,
                    height: attachment.height,
                    type,
                    chatluna_file_url: src
                })
            )
        }
    }
}

// #endregion

declare module '../../chains/chain' {
    export interface ChainMiddlewareName {
        read_chat_message: string
        transform_chat_message: string
    }

    export interface ChainMiddlewareContextOptions {
        chatMessage?: h[]
    }
}
