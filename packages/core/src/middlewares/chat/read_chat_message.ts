import { Context, h, Session } from 'koishi'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
    readFile as fsReadFile,
    mkdtemp,
    rm,
    writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { Config } from '../../config'
import { logger } from '../../index'
import type {} from '@initencounter/sst'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'
import {
    getImageType,
    getMessageContent,
    hashString
} from 'koishi-plugin-chatluna/utils/string'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type {} from 'koishi-plugin-chatluna-storage-service'
import { Message } from 'koishi-plugin-chatluna'
import { MessageContent, MessageContentComplex } from '@langchain/core/messages'
import {
    isForwardMessageElement,
    pickForwardMessageId
} from 'koishi-plugin-chatluna/utils/koishi'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'

type GeminiInlineFile = {
    sourceUrl: string
    fileName?: string
    mimeType: string
    data: string
    byteLength: number
    marker?: 'file' | 'voice'
}

type GeminiInlineContentPart = {
    inline_data: {
        mime_type: string
        data: string
    }
}

const CHATLUNA_DOWNLOAD_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const CHATLUNA_FFMPEG_TIMEOUT_MS = 30_000
const CHATLUNA_FFMPEG_STDERR_MAX_CHARS = 64 * 1024

const GEMINI_SUPPORTED_FILE_MIME_TYPES = new Set<string>([
    'text/html',
    'text/css',
    'text/plain',
    'text/markdown',
    'text/xml',
    'text/csv',
    'text/rtf',
    'text/javascript',
    'application/json',
    'application/pdf',
    'image/bmp',
    'image/jpeg',
    'image/png',
    'image/webp',
    'audio/mpeg',
    'audio/mp3',
    'audio/aiff',
    'audio/aac',
    'audio/flac',
    'audio/wav',
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'video/mp4',
    'video/mpeg',
    'video/mov',
    'video/avi',
    'video/x-flv',
    'video/mpg',
    'video/webm',
    'video/wmv',
    'video/3gpp'
])

const MAX_GEMINI_INLINE_TOTAL_SIZE_BYTES = 100 * 1024 * 1024
const MAX_GEMINI_INLINE_FILE_SIZE_BYTES = 100 * 1024 * 1024
const MAX_GEMINI_INLINE_PDF_SIZE_BYTES = 50 * 1024 * 1024
const MAX_GEMINI_EXTRA_FILE_INPUT_CONFIG_MB = 100
const GEMINI_LEGACY_STORAGE_MIME_TYPES = new Set<string>([
    'application/pdf',
    'text/plain',
    'text/markdown'
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
            const faceXml = `[face:${element.attrs.id}:${element.attrs.name}]`

            addMessageContent(message, faceXml)

            return true
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'img',
        async (session, element, message, model) => {
            const parsedModelInfo =
                model != null
                    ? ctx.chatluna.platform.findModel(model)
                    : undefined

            const isInstalledImageService =
                ctx.chatluna.getPlugin('image-service') != null

            if (
                parsedModelInfo?.value != null &&
                !parsedModelInfo.value.capabilities.includes(
                    ModelCapabilities.ImageInput
                )
            ) {
                if (!isInstalledImageService) {
                    logger.warn(
                        // eslint-disable-next-line max-len
                        `Model "${model}" does not support image input. Please use a model that supports vision capabilities, or install chatluna-image-service plugin to enable image description.`
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

            // Extract clean file extension from MIME type (e.g., "image/png" -> "png")
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
            addImageToContent(message, tempFile.url)
            element.attrs['imageUrl'] = tempFile.url
        },
        -100
    )

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

            // For GIF images, warn user
            if (ext === 'image/gif') {
                if (!isInstalledImageService) {
                    logger.warn(
                        `Detected GIF image, which is not supported by most models. Please install chatluna-image-service plugin to parse GIF animations.`
                    )
                }
                return false
            }

            ensureContentArray(message, `[image:${imageHash}]`)
            addImageToContent(message, base64Source, imageHash)
        } catch (error) {
            const displayUrl =
                url.length > 100 ? url.substring(0, 100) + '...' : url
            logger.warn(
                `Failed to read image from ${displayUrl}. Please check your Koishi chat adapter.`,
                error
            )
        }
    }

    ctx.inject(['sst'], (ctx) => {
        logger.debug('sst service loaded.')

        ctx.effect(() =>
            ctx.chatluna.messageTransformer.intercept(
                'audio',
                async (session, element, message, model) => {
                    const isGeminiModel =
                        model != null && isGeminiAdapterModel(model)
                    const hasGeminiReadFilesTool = ctx.chatluna.platform
                        .getTools()
                        .value.includes('gemini_read_files')

                    if (isGeminiModel && hasGeminiReadFilesTool) {
                        logger.debug(
                            'Skip sst audio2text because gemini_read_files is enabled for Gemini model.'
                        )
                        return
                    }

                    // The sst service only use session
                    const content = await ctx.sst.audio2text(session)
                    logger.debug(`audio2text: ${content}`)
                    addMessageContent(message, content)
                }
            )
        )
    })

    const handleFileLikeElement = async (
        session: Session,
        element: h,
        message: Message,
        model?: string
    ) => {
        const isAudioElement = element.type === 'audio'
        const isVideoElement = element.type === 'video'
        let fileName = element.attrs['file'] ?? element.attrs['filename']
        if (!isVideoElement) {
            fileName =
                element.attrs['file'] ??
                element.attrs['name'] ??
                element.attrs['filename']
        }
        const srcAttr =
            (element.attrs['src'] as string | undefined) ??
            (element.attrs['url'] as string | undefined)
        const isGeminiModel = model != null && isGeminiAdapterModel(model)

        // For non-Gemini models, let sst interceptor be the only audio handler
        // to avoid duplicate transcript + voice-link injections.
        if (isAudioElement && ctx.sst != null && !isGeminiModel) {
            return
        }

        let sourceUrl = srcAttr
        if (!srcAttr?.startsWith('http')) {
            sourceUrl = await getPlatformFileUrl(ctx, session, element)
        }

        if (!sourceUrl) {
            logger.warn(
                `Failed to get source URL for element: ${element.toString()}`
            )
            return
        }

        const isGemmaModel = model != null && isGemmaAdapterModel(model)
        let sizePrecheck: { skip: boolean; mimeType: string | null } = {
            skip: false,
            mimeType: null
        }
        let geminiExtraFileLimitBytes: number | null = null

        if (isGeminiModel) {
            geminiExtraFileLimitBytes =
                readGeminiExtraFileLimitBytesFromElement(element)
            const inferredMimeType = inferGeminiMimeTypeFromSource(
                sourceUrl,
                fileName
            )
            if (
                isGemmaModel &&
                isGeminiAudioOrVideoMimeType(inferredMimeType)
            ) {
                addMessageContent(
                    message,
                    `File: ${fileName ?? 'attachment'} ${sourceUrl} (skipped: current Gemma model does not support audio/video file input)`
                )
                return
            }

            sizePrecheck = await precheckGeminiFileSizeBeforeDownload(
                ctx,
                sourceUrl,
                inferredMimeType,
                geminiExtraFileLimitBytes,
                element
            )

            if (sizePrecheck.skip) {
                addMessageContent(
                    message,
                    `File: ${fileName ?? 'attachment'} ${sourceUrl} (skipped: file size exceeds Gemini limits)`
                )
                return
            }
        }

        const bufferResult = await readFile(ctx, sourceUrl)

        if (!bufferResult?.buffer) {
            logger.warn(
                `Failed to read file for element: ${element.toString()}`
            )
            return
        }

        let mimeType =
            normalizeGeminiMimeType(bufferResult.mimeType) ??
            sizePrecheck.mimeType ??
            inferGeminiMimeTypeFromSource(sourceUrl, fileName)
        let resolvedFileName = fileName

        if (
            isGeminiModel &&
            isGemmaModel &&
            isGeminiAudioOrVideoMimeType(mimeType)
        ) {
            addMessageContent(
                message,
                `File: ${fileName ?? 'attachment'} ${sourceUrl} (skipped: current Gemma model does not support audio/video file input)`
            )
            return
        }

        let resolvedBuffer = bufferResult.buffer

        if (isGeminiModel && isAudioElement) {
            const converted = await tryConvertAudioToMp3(
                resolvedBuffer,
                resolvedFileName,
                mimeType
            )
            if (converted != null) {
                resolvedBuffer = Buffer.from(converted.buffer)
                mimeType = 'audio/mpeg'
                resolvedFileName = converted.fileName
            }
        }

        let acceptedByGeminiCollection = false
        let isWithinGeminiFileSizeLimit = true
        if (isGeminiModel) {
            const isGeminiExtraFile =
                mimeType != null && isGeminiExtraSupportedMimeType(mimeType)
            isWithinGeminiFileSizeLimit = isGeminiFileWithinSizeLimit(
                mimeType,
                resolvedBuffer.byteLength,
                geminiExtraFileLimitBytes,
                element
            )

            if (!isWithinGeminiFileSizeLimit) {
                addMessageContent(
                    message,
                    `File: ${resolvedFileName ?? fileName ?? 'attachment'} ${sourceUrl} (skipped: file size exceeds configured Gemini extra file limit)`
                )
                return
            }

            // Gemini extra file types are kept as file links in message context.
            // They are converted when gemini_read_files tool executes.
            if (mimeType != null && !isGeminiExtraFile) {
                acceptedByGeminiCollection = tryAttachGeminiInlineFile(
                    message,
                    {
                        sourceUrl: sourceUrl ?? '',
                        fileName: resolvedFileName,
                        mimeType,
                        data: resolvedBuffer.toString('base64'),
                        byteLength: resolvedBuffer.byteLength,
                        marker: isAudioElement ? 'voice' : 'file'
                    },
                    element
                )
            }
        }

        if (!ctx.chatluna_storage) {
            element.attrs['file'] = resolvedFileName ?? fileName ?? 'attachment'
            element.attrs['filename'] =
                resolvedFileName ?? fileName ?? 'attachment'
            element.attrs['chatluna_file_url'] = sourceUrl
            const label = isAudioElement ? 'Voice' : 'File'
            addMessageContent(
                message,
                `${label}: ${resolvedFileName ?? 'attachment'} ${sourceUrl ?? ''}`.trim()
            )
            return
        }

        const storageConfig = (
            ctx.chatluna_storage as unknown as {
                config?: { storeGeminiExtendedFileTypesInStorage?: boolean }
            }
        )?.config
        const shouldStore = shouldStoreFileInStorage(
            Boolean(storageConfig?.storeGeminiExtendedFileTypesInStorage),
            isGeminiModel,
            mimeType,
            acceptedByGeminiCollection,
            isWithinGeminiFileSizeLimit
        )

        if (!shouldStore) {
            element.attrs['file'] = resolvedFileName ?? fileName ?? 'attachment'
            element.attrs['filename'] =
                resolvedFileName ?? fileName ?? 'attachment'
            element.attrs['chatluna_file_url'] = sourceUrl
            const label = isAudioElement ? 'Voice' : 'File'
            addMessageContent(
                message,
                `${label}: ${resolvedFileName ?? 'attachment'} ${sourceUrl ?? ''}`.trim()
            )
            return
        }

        const file = await ctx.chatluna_storage.createTempFile(
            resolvedBuffer,
            resolvedFileName
        )
        const displayFileName = resolvedFileName ?? fileName ?? file.name

        element.attrs['file'] = displayFileName
        element.attrs['filename'] = displayFileName
        element.attrs['chatluna_file_url'] = file.url

        addMessageContent(
            message,
            `${isAudioElement ? 'Voice' : 'File'}: ${displayFileName} ${file.url}`
        )
    }

    ctx.chatluna.messageTransformer.intercept(
        'file',
        async (session, element, message, model) =>
            await handleFileLikeElement(session, element, message, model)
    )

    ctx.chatluna.messageTransformer.intercept(
        'video',
        async (session, element, message, model) =>
            await handleFileLikeElement(session, element, message, model)
    )

    ctx.chatluna.messageTransformer.intercept(
        'audio',
        async (session, element, message, model) =>
            await handleFileLikeElement(session, element, message, model)
    )
}

async function getPlatformFileUrl(ctx: Context, session: Session, element: h) {
    const fileId = element.attrs['fileId'] ?? element.attrs['fileid']

    let fileUrl: string

    if (session.platform === 'onebot') {
        const bot = session.bot as OneBotBot<Context>
        const busId = element.attrs['busId'] ?? element.attrs['busid']

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
    }

    if (!fileUrl) {
        logger.warn(`Failed to get file URL for element: ${element.toString()}`)
        return
    }

    return fileUrl
}

async function readFile(ctx: Context, url: string) {
    try {
        const response = await ctx.http(url, {
            responseType: 'arraybuffer',
            method: 'get',
            headers: {
                'User-Agent': CHATLUNA_DOWNLOAD_USER_AGENT
            }
        })

        const buffer = Buffer.from(response.data)
        const mimeType = extractContentType(response?.headers)

        return {
            buffer,
            mimeType
        }
    } catch (error) {
        logger.error(`Failed to read file from ${url}:`, error)
        return {
            buffer: null,
            mimeType: null
        }
    }
}

function normalizeToMp3FileName(fileName?: string): string {
    const source = (fileName ?? 'voice').trim()
    const dotIndex = source.lastIndexOf('.')
    if (dotIndex <= 0) {
        return `${source}.mp3`
    }
    return `${source.slice(0, dotIndex)}.mp3`
}

async function tryConvertAudioToMp3(
    inputBuffer: Buffer,
    fileName?: string,
    mimeType?: string | null
): Promise<{ buffer: Buffer; fileName: string } | null> {
    const lowerMime = (mimeType ?? '').toLowerCase()
    const lowerName = (fileName ?? '').toLowerCase()
    const alreadyMp3 =
        lowerMime === 'audio/mpeg' ||
        lowerMime === 'audio/mp3' ||
        lowerName.endsWith('.mp3')
    if (alreadyMp3) {
        return null
    }

    let tempDir = ''
    try {
        tempDir = await mkdtemp(join(tmpdir(), 'chatluna-audio-'))
        const inputPath = join(tempDir, 'input.audio')
        const outputPath = join(tempDir, 'output.mp3')
        await writeFile(inputPath, inputBuffer)

        await runFfmpegConvertToMp3(inputPath, outputPath)
        const outputBuffer = await fsReadFile(outputPath)
        return {
            buffer: outputBuffer,
            fileName: normalizeToMp3FileName(fileName)
        }
    } catch (error) {
        logger.warn(
            `Audio transcoding to mp3 failed, fallback to original audio: ${error instanceof Error ? error.message : String(error)}`
        )
        return null
    } finally {
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true }).catch(() => {})
        }
    }
}

async function runFfmpegConvertToMp3(
    inputPath: string,
    outputPath: string
): Promise<void> {
    const ffmpegBinary = await resolveFfmpegBinaryPath()

    return new Promise((resolve, reject) => {
        const proc = spawn(ffmpegBinary ?? 'ffmpeg', [
            '-y',
            '-i',
            inputPath,
            '-vn',
            '-acodec',
            'libmp3lame',
            '-q:a',
            '4',
            outputPath
        ])

        let stderr = ''
        const timeout = setTimeout(() => {
            proc.kill('SIGKILL')
            reject(
                new Error(
                    `ffmpeg timeout after ${CHATLUNA_FFMPEG_TIMEOUT_MS}ms. ${stderr.trim()}`.trim()
                )
            )
        }, CHATLUNA_FFMPEG_TIMEOUT_MS)
        proc.stderr.on('data', (chunk) => {
            if (stderr.length >= CHATLUNA_FFMPEG_STDERR_MAX_CHARS) {
                return
            }
            stderr += String(chunk).slice(
                0,
                CHATLUNA_FFMPEG_STDERR_MAX_CHARS - stderr.length
            )
        })
        proc.on('error', (error) => {
            clearTimeout(timeout)
            reject(error)
        })
        proc.on('close', (code) => {
            clearTimeout(timeout)
            if (code === 0) {
                resolve()
            } else {
                reject(
                    new Error(
                        `ffmpeg exited with code ${code}. ${stderr.trim()}`.trim()
                    )
                )
            }
        })
    })
}

async function resolveFfmpegBinaryPath(): Promise<string | null> {
    try {
        const mod = await import('ffmpeg-static')
        const value = (mod as { default?: unknown }).default
        if (typeof value === 'string' && value.length > 0) {
            return value
        }
    } catch {
        // ignore and continue with path fallback
    }

    const fallbackCandidates = [
        join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
        join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
        '/koishi/node_modules/ffmpeg-static/ffmpeg.exe',
        '/koishi/node_modules/ffmpeg-static/ffmpeg'
    ]

    for (const candidate of fallbackCandidates) {
        if (existsSync(candidate)) {
            return candidate
        }
    }

    return null
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
            headers: {
                'User-Agent': CHATLUNA_DOWNLOAD_USER_AGENT
            }
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

function extractContentType(headers: unknown): string | null {
    if (headers == null) {
        return null
    }

    const rawContentType =
        (headers as Record<string, unknown>)['content-type'] ??
        (headers as Record<string, unknown>)['Content-Type']

    if (typeof rawContentType === 'string') {
        return rawContentType
    }

    if (
        Array.isArray(rawContentType) &&
        typeof rawContentType[0] === 'string'
    ) {
        return rawContentType[0]
    }

    return null
}

function extractContentLength(headers: unknown): number | null {
    if (headers == null) {
        return null
    }

    const rawContentLength =
        (headers as Record<string, unknown>)['content-length'] ??
        (headers as Record<string, unknown>)['Content-Length']

    const asString = Array.isArray(rawContentLength)
        ? rawContentLength[0]
        : rawContentLength

    if (typeof asString !== 'string' && typeof asString !== 'number') {
        return null
    }

    const parsed = Number(asString)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizeGeminiMimeType(raw: string | null): string | null {
    if (raw == null) {
        return null
    }

    const mimeType = raw.split(';')[0]?.trim()?.toLowerCase()
    if (!mimeType || !GEMINI_SUPPORTED_FILE_MIME_TYPES.has(mimeType)) {
        return null
    }

    return mimeType
}

function inferGeminiMimeTypeFromSource(
    sourceUrl?: string,
    fileName?: string
): string | null {
    const source = (fileName ?? sourceUrl ?? '')
        .split('?')[0]
        .split('#')[0]
        .toLowerCase()

    if (source.endsWith('.png')) return 'image/png'
    if (source.endsWith('.jpg') || source.endsWith('.jpeg')) return 'image/jpeg'
    if (source.endsWith('.bmp')) return 'image/bmp'
    if (source.endsWith('.webp')) return 'image/webp'
    if (source.endsWith('.pdf')) return 'application/pdf'
    if (source.endsWith('.txt')) return 'text/plain'
    if (source.endsWith('.md')) return 'text/markdown'
    if (source.endsWith('.html') || source.endsWith('.htm')) return 'text/html'
    if (source.endsWith('.css')) return 'text/css'
    if (source.endsWith('.xml')) return 'text/xml'
    if (source.endsWith('.csv')) return 'text/csv'
    if (source.endsWith('.rtf')) return 'text/rtf'
    if (source.endsWith('.js') || source.endsWith('.mjs'))
        return 'text/javascript'
    if (source.endsWith('.json')) return 'application/json'
    if (source.endsWith('.mp4')) return 'video/mp4'
    if (source.endsWith('.mpeg')) return 'video/mpeg'
    if (source.endsWith('.mov')) return 'video/mov'
    if (source.endsWith('.avi')) return 'video/avi'
    if (source.endsWith('.flv')) return 'video/x-flv'
    if (source.endsWith('.mpg')) return 'video/mpg'
    if (source.endsWith('.webm')) return 'video/webm'
    if (source.endsWith('.wmv')) return 'video/wmv'
    if (source.endsWith('.3gp') || source.endsWith('.3gpp')) return 'video/3gpp'
    if (source.endsWith('.mp3')) return 'audio/mpeg'
    if (source.endsWith('.aiff')) return 'audio/aiff'
    if (source.endsWith('.aac')) return 'audio/aac'
    if (source.endsWith('.flac')) return 'audio/flac'
    if (source.endsWith('.wav')) return 'audio/wav'
    if (source.endsWith('.ogg')) return 'audio/ogg'
    if (source.endsWith('.m4a')) return 'audio/mp4'

    return null
}

function isGeminiAdapterModel(model: string): boolean {
    const [platform, modelName] = parseRawModelName(model)
    const platformLower = (platform ?? '').toLowerCase()
    const modelLower = (modelName ?? '').toLowerCase()

    return (
        platformLower.includes('gemini') ||
        modelLower.includes('gemini') ||
        modelLower.includes('gemma')
    )
}

function isGemmaAdapterModel(model: string): boolean {
    const [platform, modelName] = parseRawModelName(model)
    const platformLower = (platform ?? '').toLowerCase()
    const modelLower = (modelName ?? '').toLowerCase()

    return platformLower.includes('gemini') && modelLower.includes('gemma')
}

function isGeminiAudioOrVideoMimeType(mimeType: string | null): boolean {
    if (mimeType == null) {
        return false
    }

    return mimeType.startsWith('audio/') || mimeType.startsWith('video/')
}

function tryAttachGeminiInlineFile(
    message: Message,
    file: GeminiInlineFile,
    element: h
): boolean {
    const maxFileSize =
        file.mimeType === 'application/pdf'
            ? MAX_GEMINI_INLINE_PDF_SIZE_BYTES
            : MAX_GEMINI_INLINE_FILE_SIZE_BYTES

    if (file.byteLength > maxFileSize) {
        logger.warn(
            `Skip Gemini inline file: too large (${file.byteLength} bytes > ${maxFileSize} bytes), element: ${element.toString()}`
        )
        return false
    }

    const totalBytes = getGeminiInlineTotalBytes(message) + file.byteLength

    if (totalBytes > MAX_GEMINI_INLINE_TOTAL_SIZE_BYTES) {
        logger.warn(
            `Skip Gemini inline file: total size too large (${totalBytes} bytes > ${MAX_GEMINI_INLINE_TOTAL_SIZE_BYTES} bytes), element: ${element.toString()}`
        )
        return false
    }

    ensureContentArray(
        message,
        `[${file.marker ?? 'file'}:${file.fileName ?? 'attachment'}:${file.sourceUrl}]`
    )
    ;(message.content as MessageContentComplex[]).push({
        inline_data: {
            mime_type: file.mimeType,
            data: file.data
        }
    } as GeminiInlineContentPart as unknown as MessageContentComplex)

    if (message.additional_kwargs == null) {
        message.additional_kwargs = {}
    }
    ;(message.additional_kwargs as Record<string, unknown>)[
        '__gemini_inline_total_bytes'
    ] = totalBytes

    return true
}

function getGeminiInlineTotalBytes(message: Message): number {
    const kwargs = (message.additional_kwargs ?? {}) as Record<string, unknown>
    const value = kwargs['__gemini_inline_total_bytes']
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function shouldStoreFileInStorage(
    storeGeminiExtendedFileTypesInStorage: boolean,
    isGeminiModel: boolean,
    mimeType: string | null,
    acceptedByGeminiCollection: boolean,
    isWithinGeminiFileSizeLimit: boolean
): boolean {
    if (!isGeminiModel || mimeType == null) {
        return true
    }

    if (!GEMINI_SUPPORTED_FILE_MIME_TYPES.has(mimeType)) {
        return true
    }

    if (GEMINI_LEGACY_STORAGE_MIME_TYPES.has(mimeType)) {
        return true
    }

    if (!storeGeminiExtendedFileTypesInStorage) {
        return false
    }

    if (!isWithinGeminiFileSizeLimit) {
        return false
    }

    return (
        acceptedByGeminiCollection || isGeminiExtraSupportedMimeType(mimeType)
    )
}

function isGeminiExtraSupportedMimeType(mimeType: string): boolean {
    return (
        GEMINI_SUPPORTED_FILE_MIME_TYPES.has(mimeType) &&
        !GEMINI_LEGACY_STORAGE_MIME_TYPES.has(mimeType)
    )
}

async function precheckGeminiFileSizeBeforeDownload(
    ctx: Context,
    sourceUrl: string,
    inferredMimeType: string | null,
    geminiExtraFileLimitBytes: number | null,
    element: h
): Promise<{ skip: boolean; mimeType: string | null }> {
    try {
        const response = await ctx.http(sourceUrl, {
            method: 'head',
            headers: {
                'User-Agent': CHATLUNA_DOWNLOAD_USER_AGENT
            }
        })

        const contentType =
            normalizeGeminiMimeType(extractContentType(response?.headers)) ??
            inferredMimeType
        const contentLength = extractContentLength(response?.headers)

        if (contentLength == null || contentType == null) {
            return { skip: false, mimeType: contentType }
        }

        const maxSize = getGeminiMaxFileSizeBytes(
            contentType,
            geminiExtraFileLimitBytes
        )

        if (contentLength > maxSize) {
            logger.warn(
                `Skip downloading Gemini file before read: too large (${contentLength} bytes > ${maxSize} bytes), element: ${element.toString()}`
            )
            return { skip: true, mimeType: contentType }
        }

        return { skip: false, mimeType: contentType }
    } catch {
        // Some providers do not support HEAD or omit content-length.
        // Fall back to normal download path and post-download checks.
        return { skip: false, mimeType: inferredMimeType }
    }
}

function isGeminiFileWithinSizeLimit(
    mimeType: string | null,
    byteLength: number,
    geminiExtraFileLimitBytes: number | null,
    element: h
): boolean {
    if (mimeType == null || !GEMINI_SUPPORTED_FILE_MIME_TYPES.has(mimeType)) {
        return true
    }

    const maxSize = getGeminiMaxFileSizeBytes(
        mimeType,
        geminiExtraFileLimitBytes
    )

    if (byteLength <= maxSize) {
        return true
    }

    logger.warn(
        `Skip storing Gemini file: too large (${byteLength} bytes > ${maxSize} bytes), element: ${element.toString()}`
    )
    return false
}

function getGeminiMaxFileSizeBytes(
    mimeType: string,
    geminiExtraFileLimitBytes: number | null
): number {
    const apiMaxSize =
        mimeType === 'application/pdf'
            ? MAX_GEMINI_INLINE_PDF_SIZE_BYTES
            : MAX_GEMINI_INLINE_FILE_SIZE_BYTES

    if (
        geminiExtraFileLimitBytes == null ||
        !isGeminiExtraSupportedMimeType(mimeType)
    ) {
        return apiMaxSize
    }

    return Math.min(apiMaxSize, geminiExtraFileLimitBytes)
}

function readGeminiExtraFileLimitBytesFromElement(element: h): number | null {
    const raw =
        element.attrs['chatluna_gemini_extra_file_input_max_size_mb'] ??
        element.attrs['chatlunaGeminiExtraFileInputMaxSizeMb']
    const asNumber =
        typeof raw === 'number'
            ? raw
            : typeof raw === 'string'
              ? Number(raw)
              : NaN

    if (!Number.isFinite(asNumber) || asNumber <= 0) {
        return null
    }

    const normalizedMb = Math.min(
        asNumber,
        MAX_GEMINI_EXTRA_FILE_INPUT_CONFIG_MB
    )
    return Math.floor(normalizedMb * 1024 * 1024)
}

function addImageToContent(message: Message, imageUrl: string, hash?: string) {
    ;(message.content as MessageContentComplex[]).push({
        type: 'image_url',
        image_url: {
            url: imageUrl,
            ...(hash && { hash })
        }
    })
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

declare module '../../chains/chain' {
    export interface ChainMiddlewareName {
        read_chat_message: string
    }
}
