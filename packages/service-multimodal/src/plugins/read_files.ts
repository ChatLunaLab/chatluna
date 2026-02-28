/* eslint-disable max-len */
import { StructuredTool } from '@langchain/core/tools'
import { HumanMessage, MessageContentComplex } from '@langchain/core/messages'
import { Context } from 'koishi'
import { ComputedRef, Message } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ChatLunaToolRunnable,
    ModelCapabilities
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    isMessageContentAudio,
    isMessageContentVideo,
    type MessageContentAudio,
    type MessageContentVideo
} from 'koishi-plugin-chatluna/utils/langchain'
import { getBase64EncodedSize } from 'koishi-plugin-chatluna/utils/base64'
import { Config, logger } from '..'
import {
    addImageToContent,
    addTextToContent,
    parseGifToFrames,
    processImageWithModel
} from '../utils'
import z from 'zod'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/bmp',
    'image/webp',
    'image/gif'
])

const DEFAULT_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024
const DEFAULT_MAX_TOTAL_SIZE_BYTES = 100 * 1024 * 1024

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isHttpOrHttpsUrl(url: string): boolean {
    try {
        const parsed = new URL(url)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
        return false
    }
}

function normalizeMimeType(raw: string | null): string | null {
    if (raw == null) return null
    const mimeType = raw.split(';')[0]?.trim()?.toLowerCase()
    return mimeType || null
}

function inferMimeTypeFromUrl(url: string): string | null {
    try {
        const pathname = new URL(url).pathname.toLowerCase()
        if (pathname.endsWith('.png')) return 'image/png'
        if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg'))
            return 'image/jpeg'
        if (pathname.endsWith('.bmp')) return 'image/bmp'
        if (pathname.endsWith('.webp')) return 'image/webp'
        if (pathname.endsWith('.gif')) return 'image/gif'
        if (pathname.endsWith('.pdf')) return 'application/pdf'
        if (pathname.endsWith('.txt')) return 'text/plain'
        if (pathname.endsWith('.md')) return 'text/markdown'
        if (pathname.endsWith('.html') || pathname.endsWith('.htm'))
            return 'text/html'
        if (pathname.endsWith('.css')) return 'text/css'
        if (pathname.endsWith('.xml')) return 'text/xml'
        if (pathname.endsWith('.csv')) return 'text/csv'
        if (pathname.endsWith('.rtf')) return 'text/rtf'
        if (pathname.endsWith('.js') || pathname.endsWith('.mjs'))
            return 'text/javascript'
        if (pathname.endsWith('.json')) return 'application/json'
        if (pathname.endsWith('.mp4')) return 'video/mp4'
        if (pathname.endsWith('.mpeg')) return 'video/mpeg'
        if (pathname.endsWith('.mov')) return 'video/mov'
        if (pathname.endsWith('.avi')) return 'video/avi'
        if (pathname.endsWith('.flv')) return 'video/x-flv'
        if (pathname.endsWith('.mpg')) return 'video/mpg'
        if (pathname.endsWith('.webm')) return 'video/webm'
        if (pathname.endsWith('.wmv')) return 'video/wmv'
        if (pathname.endsWith('.3gp') || pathname.endsWith('.3gpp'))
            return 'video/3gpp'
        if (pathname.endsWith('.mp3')) return 'audio/mpeg'
        if (pathname.endsWith('.aiff')) return 'audio/aiff'
        if (pathname.endsWith('.aac')) return 'audio/aac'
        if (pathname.endsWith('.flac')) return 'audio/flac'
        if (pathname.endsWith('.wav')) return 'audio/wav'
        if (pathname.endsWith('.ogg')) return 'audio/ogg'
        if (pathname.endsWith('.m4a')) return 'audio/mp4'
    } catch {
        // ignore
    }
    return null
}

function classifyError(error: unknown): string {
    const message =
        error instanceof Error ? error.message.toLowerCase() : String(error)

    if (message.includes('only http/https urls are supported'))
        return 'invalid_url_scheme'
    if (message.includes('unsupported mime type'))
        return 'unsupported_mime_type'
    if (message.includes('file too large')) return 'file_too_large'
    if (message.includes('total inline upload size too large'))
        return 'total_size_exceeded'
    if (message.includes('http ')) return 'fetch_failed'
    return 'internal_error'
}

/**
 * Check whether the model natively supports a given MIME type based on its
 * capabilities and `FileHandlingConfig`.
 */
function modelSupportsNativeMimeType(
    model: ChatLunaChatModel,
    mimeType: string
): boolean {
    const caps = model.modelInfo.capabilities

    let capabilitySupportsMime = false
    if (IMAGE_MIME_TYPES.has(mimeType)) {
        capabilitySupportsMime = caps.includes(ModelCapabilities.ImageInput)
    } else if (mimeType.startsWith('audio/')) {
        capabilitySupportsMime = caps.includes(ModelCapabilities.AudioInput)
    } else if (mimeType.startsWith('video/')) {
        capabilitySupportsMime = caps.includes(ModelCapabilities.VideoInput)
    } else if (
        mimeType.startsWith('text/') ||
        mimeType === 'application/json' ||
        mimeType === 'application/pdf'
    ) {
        capabilitySupportsMime = caps.includes(ModelCapabilities.FileInput)
    }

    if (!capabilitySupportsMime) {
        return false
    }

    const fileConfig = model.fileHandlingConfig
    if (fileConfig != null) {
        return fileConfig.supportedMimeTypes.has(mimeType)
    }

    return true
}

/**
 * Build a multimodal `HumanMessage` containing the file(s) as content parts,
 * suitable for injecting into the conversation context.
 */
function buildMultimodalMessage(
    parts: {
        mimeType: string
        base64Data: string
        sourceUrl: string
    }[],
    insertPrompt: string
): HumanMessage {
    const content: MessageContentComplex[] = []

    for (const part of parts) {
        const { mimeType, base64Data } = part

        if (IMAGE_MIME_TYPES.has(mimeType)) {
            content.push({
                type: 'image_url',
                image_url: {
                    url: `data:${mimeType};base64,${base64Data}`
                }
            })
        } else if (mimeType.startsWith('audio/')) {
            const audioContent: MessageContentAudio = {
                type: 'audio_url',
                audio_url: {
                    url: `data:${mimeType};base64,${base64Data}`,
                    mimeType
                }
            }

            if (isMessageContentAudio(audioContent as MessageContentComplex)) {
                content.push(audioContent as MessageContentComplex)
            }
        } else if (mimeType.startsWith('video/')) {
            const videoContent: MessageContentVideo = {
                type: 'video_url',
                video_url: {
                    url: `data:${mimeType};base64,${base64Data}`,
                    mimeType
                }
            }

            if (isMessageContentVideo(videoContent as MessageContentComplex)) {
                content.push(videoContent as MessageContentComplex)
            }
        } else {
            // Inline data for text/pdf/etc. (Gemini-style)
            content.push({
                inline_data: {
                    mime_type: mimeType,
                    data: base64Data
                }
            } as unknown as MessageContentComplex)
        }
    }

    if (content.length > 0) {
        content.unshift({
            type: 'text',
            text: insertPrompt
        })
    }

    return new HumanMessage({ content })
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export class ReadFilesTool extends StructuredTool {
    name = 'read_files'

    description = `Read file URL(s) and return their content. If the current model natively supports the file type, the content is injected as multimodal context for the next conversation turn. Otherwise, images are described using a vision model.
Supported file types depend on the model. Common types include:
- Text: text/html, text/css, text/plain, text/markdown, text/xml, text/csv, text/rtf, text/javascript
- Application: application/json, application/pdf
- Image: image/bmp, image/jpeg, image/png, image/webp, image/gif
- Audio: audio/mpeg, audio/mp3, audio/aiff, audio/aac, audio/flac, audio/wav, audio/webm, audio/ogg, audio/mp4
- Video: video/mp4, video/mpeg, video/mov, video/avi, video/x-flv, video/mpg, video/webm, video/wmv, video/3gpp
Use this tool when you need to read files from URL(s) as context.`

    schema = z.object({
        urls: z
            .union([
                z.string().url().refine(isHttpOrHttpsUrl, {
                    message: 'Only http/https URLs are supported.'
                }),
                z
                    .array(
                        z.string().url().refine(isHttpOrHttpsUrl, {
                            message: 'Only http/https URLs are supported.'
                        })
                    )
                    .min(1)
                    .max(10)
            ])
            .describe(
                'One URL or a list of URLs to read (max 10). The file content will be made available as context.'
            )
    })

    constructor(
        private readonly ctx: Context,
        private readonly config: Config,
        private readonly imageModelRef: () => ComputedRef<
            ChatLunaChatModel | undefined
        >
    ) {
        super({})
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _: unknown,
        runConfig?: ChatLunaToolRunnable
    ) {
        const urls = Array.isArray(input.urls) ? input.urls : [input.urls]
        const model = runConfig?.configurable?.model
        const conversationId = runConfig?.configurable?.conversationId
        const fileConfig = model?.fileHandlingConfig

        let totalBase64Bytes = 0
        const maxTotalSize =
            fileConfig?.maxTotalSizeBytes ?? DEFAULT_MAX_TOTAL_SIZE_BYTES

        const nativeParts: {
            mimeType: string
            base64Data: string
            sourceUrl: string
        }[] = []

        const response: {
            files: {
                sourceUrl: string
                mimeType?: string
                status: 'ok' | 'described' | 'error'
                description?: string
                error?: string
            }[]
            successCount: number
            failureCount: number
        } = {
            files: [],
            successCount: 0,
            failureCount: 0
        }
        let describedCount = 0

        for (const sourceUrl of urls) {
            try {
                if (!isHttpOrHttpsUrl(sourceUrl)) {
                    throw new Error(
                        'Only http/https URLs are supported for read_files.'
                    )
                }

                // Determine MIME type first by fetching with headers
                const controller = new AbortController()
                const timeout = setTimeout(() => controller.abort(), 60_000)
                const httpResponse = await this.ctx
                    .http(sourceUrl, {
                        responseType: 'arraybuffer',
                        method: 'get',
                        headers: {
                            'User-Agent':
                                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
                        },
                        signal: controller.signal
                    })
                    .finally(() => {
                        clearTimeout(timeout)
                    })

                const buffer = Buffer.from(httpResponse.data)

                // Resolve MIME type from response headers or URL
                const headers = httpResponse.headers as unknown as
                    | Record<string, unknown>
                    | undefined
                const rawCt =
                    headers?.['content-type'] ?? headers?.['Content-Type']
                let responseMimeType: string | null = null
                if (typeof rawCt === 'string') {
                    responseMimeType = normalizeMimeType(rawCt)
                } else if (
                    Array.isArray(rawCt) &&
                    typeof rawCt[0] === 'string'
                ) {
                    responseMimeType = normalizeMimeType(rawCt[0])
                }

                const mimeType =
                    responseMimeType ?? inferMimeTypeFromUrl(sourceUrl)

                if (!mimeType) {
                    throw new Error(
                        `Could not determine MIME type for ${sourceUrl}. Please ensure the URL returns a valid content type.`
                    )
                }

                // Check if the model supports this MIME type natively
                const isImage = IMAGE_MIME_TYPES.has(mimeType)
                const modelSupports =
                    model != null &&
                    modelSupportsNativeMimeType(model, mimeType)

                if (modelSupports && !isImage) {
                    // Non-image file that the model supports natively -> inline inject
                    const maxFileSize =
                        fileConfig?.maxFileSizeBytesOverrides?.[mimeType] ??
                        fileConfig?.maxFileSizeBytes ??
                        DEFAULT_MAX_FILE_SIZE_BYTES

                    const encodedSize = getBase64EncodedSize(buffer.byteLength)

                    if (encodedSize > maxFileSize) {
                        throw new Error(
                            `File too large (${encodedSize} bytes after base64), max ${maxFileSize} bytes for ${mimeType}`
                        )
                    }

                    if (totalBase64Bytes + encodedSize > maxTotalSize) {
                        throw new Error(
                            `Total inline upload size too large (${totalBase64Bytes + encodedSize} bytes), max ${maxTotalSize} bytes per request`
                        )
                    }

                    totalBase64Bytes += encodedSize
                    nativeParts.push({
                        mimeType,
                        base64Data: buffer.toString('base64'),
                        sourceUrl
                    })

                    response.files.push({
                        sourceUrl,
                        mimeType,
                        status: 'ok'
                    })
                    response.successCount++
                } else if (isImage && modelSupports) {
                    // Image that the model supports natively -> inject directly
                    // Unified per-file size check before any branching
                    const maxFileSize =
                        fileConfig?.maxFileSizeBytesOverrides?.[mimeType] ??
                        fileConfig?.maxFileSizeBytes ??
                        DEFAULT_MAX_FILE_SIZE_BYTES

                    const encodedSize = getBase64EncodedSize(buffer.byteLength)

                    if (encodedSize > maxFileSize) {
                        throw new Error(
                            `File too large (${encodedSize} bytes after base64, raw ${buffer.byteLength} bytes), max ${maxFileSize} bytes for ${mimeType}`
                        )
                    }

                    // For GIF: split into frames
                    if (mimeType === 'image/gif') {
                        const frames = await parseGifToFrames(buffer, {
                            strategy: this.config.gifStrategy,
                            frameCount: this.config.gifFrameCount
                        })

                        logger.debug(
                            `Extracted ${frames.length} frames from GIF for native model injection`
                        )

                        for (const frame of frames) {
                            // Frames are data:image/png;base64,... strings
                            const frameBase64 = frame.split(',')[1]
                            const frameSize = getBase64EncodedSize(
                                Buffer.from(frameBase64, 'base64').byteLength
                            )

                            if (totalBase64Bytes + frameSize > maxTotalSize) {
                                logger.warn(
                                    'Skipping remaining GIF frames due to total size limit'
                                )
                                break
                            }

                            totalBase64Bytes += frameSize
                            nativeParts.push({
                                mimeType: 'image/png',
                                base64Data: frameBase64,
                                sourceUrl
                            })
                        }
                    } else {
                        if (totalBase64Bytes + encodedSize > maxTotalSize) {
                            throw new Error(
                                `Total inline upload size too large (${totalBase64Bytes + encodedSize} bytes), max ${maxTotalSize} bytes per request`
                            )
                        }

                        totalBase64Bytes += encodedSize
                        nativeParts.push({
                            mimeType,
                            base64Data: buffer.toString('base64'),
                            sourceUrl
                        })
                    }

                    response.files.push({
                        sourceUrl,
                        mimeType,
                        status: 'ok'
                    })
                    response.successCount++
                } else if (isImage) {
                    // Image but model doesn't support it natively -> describe using image model
                    const maxFileSize =
                        fileConfig?.maxFileSizeBytesOverrides?.[mimeType] ??
                        fileConfig?.maxFileSizeBytes ??
                        DEFAULT_MAX_FILE_SIZE_BYTES

                    const encodedSize = getBase64EncodedSize(buffer.byteLength)

                    if (encodedSize > maxFileSize) {
                        throw new Error(
                            `File too large (${encodedSize} bytes after base64, raw ${buffer.byteLength} bytes), max ${maxFileSize} bytes for ${mimeType}`
                        )
                    }

                    const describeResult = await this._describeImageWithModel(
                        sourceUrl,
                        buffer,
                        mimeType
                    )

                    if (describeResult) {
                        response.files.push({
                            sourceUrl,
                            mimeType,
                            status: 'described',
                            description: describeResult
                        })
                        response.successCount++
                        describedCount++
                    } else {
                        throw new Error(
                            `Failed to describe image from ${sourceUrl}`
                        )
                    }
                } else {
                    // Non-image, model doesn't support it natively
                    throw new Error(
                        `Unsupported MIME type "${mimeType}" for the current model. The model does not natively support this file type.`
                    )
                }
            } catch (error) {
                logger.warn(`read_files error for ${sourceUrl}:`, error)
                response.files.push({
                    sourceUrl,
                    status: 'error',
                    error: classifyError(error)
                })
                response.failureCount++
            }
        }

        // Inject native parts into next-round context via contextManager
        if (nativeParts.length > 0 && conversationId) {
            const message = buildMultimodalMessage(
                nativeParts,
                this.config.fileInsertPrompt
            )

            this.ctx.chatluna.contextManager.inject({
                conversationId,
                name: 'read_files_context',
                value: message,
                once: true,
                stage: 'after_scratchpad'
            })

            logger.debug(
                `Injected ${nativeParts.length} file part(s) into context for conversation ${conversationId}`
            )
        }

        return JSON.stringify({
            response,
            note:
                nativeParts.length > 0
                    ? `Successfully read ${nativeParts.length} file(s). The file content has been added to the conversation context and will be available in the next turn.`
                    : describedCount > 0
                      ? `Described ${describedCount} image file(s) using the vision model.`
                      : response.failureCount > 0
                        ? `Failed to read ${response.failureCount} file(s).`
                        : 'No files were processed.'
        })
    }

    /**
     * Describe an image using the configured image model (fallback when the
     * main model doesn't support image input).
     */
    private async _describeImageWithModel(
        url: string,
        buffer: Buffer,
        mimeType: string
    ): Promise<string | null> {
        const imageModel = this.imageModelRef().value
        if (imageModel == null) {
            logger.warn(
                'Image model is not loaded, cannot describe image. Please check your chat adapter.'
            )
            return null
        }

        if (
            !imageModel.modelInfo.capabilities.includes(
                ModelCapabilities.ImageInput
            )
        ) {
            logger.warn('Image model does not support image input.')
            return null
        }

        try {
            const fakeMessage: Message = { content: [] }

            if (mimeType === 'image/gif') {
                const frames = await parseGifToFrames(buffer, {
                    strategy: this.config.gifStrategy,
                    frameCount: this.config.gifFrameCount
                })

                addTextToContent(
                    fakeMessage,
                    'This is a GIF image. See the frames below:'
                )
                for (const frame of frames) {
                    addImageToContent(fakeMessage, frame)
                }
            } else {
                const base64 = buffer.toString('base64')
                const base64Source = `data:${mimeType};base64,${base64}`
                addImageToContent(fakeMessage, base64Source)
            }

            return await processImageWithModel(
                imageModel,
                this.config,
                fakeMessage
            )
        } catch (error) {
            logger.warn(`Describe image ${url} error:`, error)
            return null
        }
    }
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (!config.enableMultimodalTool) return

    const imageUnderstandModel = await ctx.chatluna.createChatModel(
        config.imageModel
    )

    plugin.registerTool('read_files', {
        selector() {
            return true
        },
        createTool() {
            return new ReadFilesTool(ctx, config, () => imageUnderstandModel)
        }
    })
}
