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

const FILE_EXTENSION_TO_MIME_TYPE = new Map<string, string>([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.bmp', 'image/bmp'],
    ['.webp', 'image/webp'],
    ['.gif', 'image/gif'],
    ['.pdf', 'application/pdf'],
    ['.txt', 'text/plain'],
    ['.md', 'text/markdown'],
    ['.html', 'text/html'],
    ['.htm', 'text/html'],
    ['.css', 'text/css'],
    ['.xml', 'text/xml'],
    ['.csv', 'text/csv'],
    ['.rtf', 'text/rtf'],
    ['.js', 'text/javascript'],
    ['.mjs', 'text/javascript'],
    ['.json', 'application/json'],
    ['.mp4', 'video/mp4'],
    ['.mpeg', 'video/mpeg'],
    ['.mov', 'video/mov'],
    ['.avi', 'video/avi'],
    ['.flv', 'video/x-flv'],
    ['.mpg', 'video/mpg'],
    ['.webm', 'video/webm'],
    ['.wmv', 'video/wmv'],
    ['.3gp', 'video/3gpp'],
    ['.3gpp', 'video/3gpp'],
    ['.mp3', 'audio/mpeg'],
    ['.aiff', 'audio/aiff'],
    ['.aac', 'audio/aac'],
    ['.flac', 'audio/flac'],
    ['.wav', 'audio/wav'],
    ['.ogg', 'audio/ogg'],
    ['.m4a', 'audio/mp4']
])

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

function inferMimeTypeFromPath(path: string): string | null {
    const sanitizedPath = path.toLowerCase().split(/[?#]/, 1)[0]
    const fileName = sanitizedPath.split(/[/\\]/).pop() ?? sanitizedPath
    const extensionIndex = fileName.lastIndexOf('.')

    if (extensionIndex < 0) {
        return null
    }

    const extension = fileName.slice(extensionIndex)
    return FILE_EXTENSION_TO_MIME_TYPE.get(extension) ?? null
}

function inferMimeTypeFromUrl(url: string): string | null {
    try {
        const pathname = new URL(url).pathname
        return inferMimeTypeFromPath(pathname)
    } catch {
        // ignore
    }

    return null
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

function isMimeTypeEnabled(config: Config, mimeType: string): boolean {
    if (mimeType === 'image/gif') {
        return config.enableGifReadTool
    }

    if (IMAGE_MIME_TYPES.has(mimeType)) {
        return config.enableImageReadTool
    }

    return config.enableFileReadTool
}

function buildReadFilesDescription(config: Config): string {
    const sections: string[] = []

    if (config.enableImageReadTool) {
        sections.push(
            '- Image read/describe (non-GIF): image/bmp, image/jpeg, image/png, image/webp. If the model lacks native image input, fallback image description will be used.'
        )
    }

    if (config.enableGifReadTool) {
        sections.push(
            '- GIF read/describe: image/gif. Native-capable models receive extracted frames; otherwise fallback image description is used.'
        )
    }

    if (config.enableFileReadTool) {
        sections.push(
            '- File read: text/html, text/css, text/plain, text/markdown, text/xml, text/csv, text/rtf, text/javascript, application/json, application/pdf, audio/*, video/* (effective MIME set still depends on model capabilities and FileHandlingConfig).'
        )
    }

    return `Read files from URL(s) and return their content.
Enabled read_files capabilities:
${sections.join('\n')}
Use this tool when you need to read files from URL(s) as context.`
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
    description: string

    schema = z.object({
        files: z
            .union([
                z.object({
                    url: z.string().url()
                }),
                z
                    .array(
                        z.object({
                            url: z.string().url()
                        })
                    )
                    .min(1)
                    .max(10)
            ])
            .describe(
                'One file or a list of files to read (max 10). File format: { url: string }. MIME type is inferred from response headers, then URL extension.'
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
        this.description = buildReadFilesDescription(config)
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _: unknown,
        runConfig?: ChatLunaToolRunnable
    ) {
        const files = Array.isArray(input.files) ? input.files : [input.files]
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

        for (const file of files) {
            const sourceUrl = file.url

            const pushError = (errorMessage: string, mimeType?: string) => {
                response.files.push({
                    sourceUrl,
                    mimeType,
                    status: 'error',
                    error: errorMessage
                })
                response.failureCount++
            }

            try {
                if (!isHttpOrHttpsUrl(sourceUrl)) {
                    pushError(
                        'Only http/https URLs are supported for read_files.'
                    )
                    continue
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
                    pushError(
                        `Could not determine MIME type for ${sourceUrl}. Please ensure the URL returns a valid content type.`
                    )
                    continue
                }

                if (!isMimeTypeEnabled(this.config, mimeType)) {
                    pushError(
                        `Feature disabled for MIME type "${mimeType}". Please enable the corresponding read_files switch.`,
                        mimeType
                    )
                    continue
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
                        pushError(
                            `File too large (${encodedSize} bytes after base64), max ${maxFileSize} bytes for ${mimeType}`,
                            mimeType
                        )
                        continue
                    }

                    if (totalBase64Bytes + encodedSize > maxTotalSize) {
                        pushError(
                            `Total inline upload size too large (${totalBase64Bytes + encodedSize} bytes), max ${maxTotalSize} bytes per request`,
                            mimeType
                        )
                        continue
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
                        pushError(
                            `File too large (${encodedSize} bytes after base64, raw ${buffer.byteLength} bytes), max ${maxFileSize} bytes for ${mimeType}`,
                            mimeType
                        )
                        continue
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
                            pushError(
                                `Total inline upload size too large (${totalBase64Bytes + encodedSize} bytes), max ${maxTotalSize} bytes per request`,
                                mimeType
                            )
                            continue
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
                        pushError(
                            `File too large (${encodedSize} bytes after base64, raw ${buffer.byteLength} bytes), max ${maxFileSize} bytes for ${mimeType}`,
                            mimeType
                        )
                        continue
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
                        pushError(
                            `Failed to describe image from ${sourceUrl}`,
                            mimeType
                        )
                        continue
                    }
                } else {
                    // Non-image, model doesn't support it natively
                    pushError(
                        `Unsupported MIME type "${mimeType}" for the current model. The model does not natively support this file type.`,
                        mimeType
                    )
                    continue
                }
            } catch (error) {
                logger.warn(`read_files error for ${sourceUrl}:`, error)
                const errorMessage =
                    error instanceof Error ? error.message : String(error)
                pushError(errorMessage)
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
    if (
        !config.enableImageReadTool &&
        !config.enableGifReadTool &&
        !config.enableFileReadTool
    ) {
        return
    }

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
