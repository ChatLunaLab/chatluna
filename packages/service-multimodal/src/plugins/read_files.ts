/* eslint-disable max-len */
import { StructuredTool } from '@langchain/core/tools'
import { HumanMessage, MessageContentComplex } from '@langchain/core/messages'
import { Context } from 'koishi'
import { ComputedRef, Message } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import type { FileHandlingConfig } from 'koishi-plugin-chatluna/llm-core/platform/client'
import {
    ChatLunaToolRunnable,
    ModelCapabilities
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { getBase64EncodedSize } from 'koishi-plugin-chatluna/utils/base64'
import { Config, logger } from '..'
import {
    addImageToContent,
    addTextToContent,
    BROWSER_UA,
    convertAudioToMp3,
    detectAudioMimeType,
    IMAGE_MIME_TYPES,
    inferMimeTypeFromUrl,
    normalizeMimeType,
    parseGifToFrames,
    processImageWithModel
} from '../utils'
import z from 'zod'

const DEFAULT_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024
const DEFAULT_MAX_TOTAL_SIZE_BYTES = 100 * 1024 * 1024

interface NativePart {
    mimeType: string
    base64Data: string
    sourceUrl: string
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export class ReadFilesTool extends StructuredTool {
    name = 'read_files'
    schema = z.object({
        files: z
            .preprocess(
                (arg: unknown) => {
                    if (typeof arg === 'string') {
                        const base = JSON.parse(arg)
                        if (
                            typeof base === 'object' &&
                            typeof base['files'] === 'string'
                        ) {
                            try {
                                base['files'] = JSON.parse(base['files'])
                                return base
                            } catch {
                                return base
                            }
                        }
                    }
                    return arg
                },
                z
                    .array(
                        z.object({
                            url: z.string().url()
                        })
                    )
                    .min(1)
                    .max(10)
            )
            .describe(
                'A list of files to read (max 10). File format: { url: string }. MIME type is inferred from response headers, then URL extension.'
            )
    })

    description: string

    constructor(
        private readonly ctx: Context,
        private readonly config: Config,
        private readonly imageModelRef: () => ComputedRef<
            ChatLunaChatModel | undefined
        >
    ) {
        super({})
        this.description = describeTool(config)
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _: unknown,
        runConfig?: ChatLunaToolRunnable
    ) {
        const files = input.files
        const model = runConfig?.configurable?.model
        const conversationId = runConfig?.configurable?.conversationId
        const fileConfig = model?.fileHandlingConfig
        const maxTotal =
            fileConfig?.maxTotalSizeBytes ?? DEFAULT_MAX_TOTAL_SIZE_BYTES

        const native: NativePart[] = []
        const report: ToolReport = {
            files: [],
            successCount: 0,
            failureCount: 0
        }
        let totalBytes = 0
        let describedCount = 0

        for (const { url: sourceUrl } of files) {
            if (!isHttp(sourceUrl)) {
                pushError(
                    report,
                    sourceUrl,
                    'Only http/https URLs are supported.'
                )
                continue
            }

            try {
                const fetched = await this._fetch(sourceUrl)
                if (!fetched) {
                    pushError(report, sourceUrl, 'Failed to fetch URL.')
                    continue
                }

                const declared =
                    normalizeMimeType(fetched.contentType) ??
                    inferMimeTypeFromUrl(sourceUrl)
                const detectedAudio = detectAudioMimeType(
                    fetched.buffer,
                    declared
                )
                const mime = detectedAudio ?? declared

                if (!mime) {
                    pushError(
                        report,
                        sourceUrl,
                        `Could not determine MIME type for ${sourceUrl}.`
                    )
                    continue
                }
                if (!mimeEnabled(this.config, mime)) {
                    pushError(
                        report,
                        sourceUrl,
                        `Feature disabled for MIME type "${mime}".`,
                        mime
                    )
                    continue
                }

                const isImage = IMAGE_MIME_TYPES.has(mime)
                const isAudio = mime.startsWith('audio/')
                const supportsNative =
                    model != null && modelSupportsMime(model, mime)

                // ----- Non-image native: maybe transcode audio, then inline ---
                if (!isImage && supportsNative) {
                    let bytes = fetched.buffer
                    let outMime = mime
                    if (
                        isAudio &&
                        fileConfig?.supportedMimeTypes &&
                        !fileConfig.supportedMimeTypes.has(mime)
                    ) {
                        const converted = await convertAudioToMp3(
                            this.ctx,
                            bytes
                        )
                        if (!converted) {
                            pushError(
                                report,
                                sourceUrl,
                                `Unsupported audio MIME "${mime}" and ffmpeg conversion failed.`,
                                mime
                            )
                            continue
                        }
                        bytes = converted
                        outMime = 'audio/mpeg'
                    }

                    const sizeError = checkSize(
                        bytes,
                        outMime,
                        fileConfig,
                        totalBytes,
                        maxTotal
                    )
                    if (sizeError) {
                        pushError(report, sourceUrl, sizeError, outMime)
                        continue
                    }
                    totalBytes += getBase64EncodedSize(bytes.byteLength)
                    pushNative(
                        report,
                        native,
                        sourceUrl,
                        outMime,
                        bytes.toString('base64')
                    )
                    continue
                }

                // ----- Image native: inject directly (GIF splits to frames) ---
                if (isImage && supportsNative) {
                    const sizeError = checkSize(
                        fetched.buffer,
                        mime,
                        fileConfig,
                        totalBytes,
                        maxTotal
                    )
                    if (sizeError) {
                        pushError(report, sourceUrl, sizeError, mime)
                        continue
                    }

                    if (mime === 'image/gif') {
                        let pushed = 0
                        const frames = await parseGifToFrames(fetched.buffer, {
                            strategy: this.config.gifStrategy,
                            frameCount: this.config.gifFrameCount
                        })
                        for (const frame of frames) {
                            const frameBase64 = frame.split(',')[1]
                            const buf = Buffer.from(frameBase64, 'base64')
                            const sizeError = checkSize(
                                buf,
                                'image/png',
                                fileConfig,
                                totalBytes,
                                maxTotal
                            )
                            if (sizeError) {
                                if (pushed < 1) {
                                    pushError(
                                        report,
                                        sourceUrl,
                                        sizeError,
                                        'image/png'
                                    )
                                }
                                logger.warn(
                                    'Skipping remaining GIF frames due to total size limit'
                                )
                                break
                            }
                            totalBytes += getBase64EncodedSize(buf.byteLength)
                            pushNative(
                                report,
                                native,
                                sourceUrl,
                                'image/png',
                                frameBase64
                            )
                            pushed++
                        }
                    } else {
                        totalBytes += getBase64EncodedSize(
                            fetched.buffer.byteLength
                        )
                        pushNative(
                            report,
                            native,
                            sourceUrl,
                            mime,
                            fetched.buffer.toString('base64')
                        )
                    }
                    continue
                }

                // ----- Image without native support: describe via vision model -
                if (isImage) {
                    const described = await this._describeImage(
                        sourceUrl,
                        fetched.buffer,
                        mime
                    )
                    if (described) {
                        report.files.push({
                            sourceUrl,
                            mimeType: mime,
                            status: 'described',
                            description: described
                        })
                        report.successCount++
                        describedCount++
                    } else {
                        pushError(
                            report,
                            sourceUrl,
                            'Failed to describe image.',
                            mime
                        )
                    }
                    continue
                }

                pushError(
                    report,
                    sourceUrl,
                    `Unsupported MIME "${mime}" for the current model.`,
                    mime
                )
            } catch (error) {
                logger.warn(`read_files error for ${sourceUrl}:`, error)
                pushError(
                    report,
                    sourceUrl,
                    error instanceof Error ? error.message : String(error)
                )
            }
        }

        const injected = native.length > 0 && !!conversationId
        if (native.length > 0 && conversationId) {
            this.ctx.chatluna.contextManager.inject({
                conversationId,
                name: 'read_files_context',
                value: buildMultimodalMessage(
                    native,
                    this.config.fileInsertPrompt
                ),
                once: true,
                stage: 'after_scratchpad'
            })
            logger.debug(
                `Injected ${native.length} file part(s) into context for conversation ${conversationId}`
            )
        }

        return JSON.stringify({
            response: report,
            note: injected
                ? `Successfully read ${native.length} file(s). The file content has been added to the conversation context and will be available in the next turn.`
                : native.length > 0
                  ? `Successfully read ${native.length} file(s), but no conversation id was available, so the file content was not added to the conversation context.`
                  : describedCount > 0
                    ? `Described ${describedCount} image file(s) using the vision model.`
                    : report.failureCount > 0
                      ? `Failed to read ${report.failureCount} file(s).`
                      : 'No files were processed.'
        })
    }

    private async _fetch(
        url: string
    ): Promise<{ buffer: Buffer; contentType: string | null } | null> {
        try {
            const response = await this.ctx.http(url, {
                responseType: 'arraybuffer',
                method: 'get',
                headers: { 'User-Agent': BROWSER_UA },
                timeout: 60_000
            })
            return {
                buffer: Buffer.from(response.data),
                contentType: getHeaderValue(response.headers, 'content-type')
            }
        } catch {
            return null
        }
    }

    private async _describeImage(
        url: string,
        buffer: Buffer,
        mimeType: string
    ): Promise<string | null> {
        const imageModel = this.imageModelRef().value
        if (
            !imageModel ||
            !imageModel.modelInfo.capabilities.includes(
                ModelCapabilities.ImageInput
            )
        ) {
            logger.warn(
                'Image model not loaded or lacks image input; cannot describe.'
            )
            return null
        }

        try {
            const fake: Message = { content: [] }
            if (mimeType === 'image/gif') {
                const frames = await parseGifToFrames(buffer, {
                    strategy: this.config.gifStrategy,
                    frameCount: this.config.gifFrameCount
                })
                addTextToContent(
                    fake,
                    'This is a GIF image. See the frames below:'
                )
                for (const frame of frames) addImageToContent(fake, frame)
            } else {
                addImageToContent(
                    fake,
                    `data:${mimeType};base64,${buffer.toString('base64')}`
                )
            }
            return await processImageWithModel(imageModel, this.config, fake)
        } catch (error) {
            logger.warn(`Describe image ${url} error:`, error)
            return null
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ToolReport {
    files: {
        sourceUrl: string
        mimeType?: string
        status: 'ok' | 'described' | 'error'
        description?: string
        error?: string
    }[]
    successCount: number
    failureCount: number
}

function pushError(
    report: ToolReport,
    sourceUrl: string,
    error: string,
    mimeType?: string
) {
    report.files.push({ sourceUrl, mimeType, status: 'error', error })
    report.failureCount++
}

function pushNative(
    report: ToolReport,
    native: NativePart[],
    sourceUrl: string,
    mimeType: string,
    base64Data: string
) {
    native.push({ sourceUrl, mimeType, base64Data })
    report.files.push({ sourceUrl, mimeType, status: 'ok' })
    report.successCount++
}

function getHeaderValue(headers: unknown, name: string): string | null {
    if (headers == null) return null

    if (typeof (headers as { get?: unknown }).get === 'function') {
        const value = (headers as { get(name: string): string | null }).get(
            name
        )
        return typeof value === 'string' ? value : null
    }

    const record = headers as Record<string, unknown>
    const lower = name.toLowerCase()
    for (const key of Object.keys(record)) {
        if (key.toLowerCase() === lower) {
            const value = record[key]
            return typeof value === 'string' ? value : null
        }
    }
    return null
}

function isHttp(url: string): boolean {
    try {
        const { protocol } = new URL(url)
        return protocol === 'http:' || protocol === 'https:'
    } catch {
        return false
    }
}

function modelSupportsMime(model: ChatLunaChatModel, mime: string): boolean {
    const caps = model.modelInfo.capabilities
    const isImage = IMAGE_MIME_TYPES.has(mime)
    const capOk = isImage
        ? caps.includes(ModelCapabilities.ImageInput)
        : mime.startsWith('audio/')
          ? caps.includes(ModelCapabilities.AudioInput)
          : mime.startsWith('video/')
            ? caps.includes(ModelCapabilities.VideoInput)
            : caps.includes(ModelCapabilities.FileInput)
    if (!capOk) return false
    const file = model.fileHandlingConfig
    return file == null || file.supportedMimeTypes.has(mime)
}

function mimeEnabled(config: Config, mime: string): boolean {
    if (mime === 'image/gif') return config.enableGifReadTool
    if (IMAGE_MIME_TYPES.has(mime)) return config.enableImageReadTool
    return config.enableFileReadTool
}

function checkSize(
    buffer: Buffer,
    mime: string,
    fileConfig: FileHandlingConfig | undefined,
    totalBytes: number,
    maxTotal: number
): string | null {
    const max =
        fileConfig?.maxFileSizeBytesOverrides?.[mime] ??
        fileConfig?.maxFileSizeBytes ??
        DEFAULT_MAX_FILE_SIZE_BYTES
    const encoded = getBase64EncodedSize(buffer.byteLength)
    if (encoded > max) {
        return `File too large (${encoded} bytes after base64, raw ${buffer.byteLength} bytes), max ${max} bytes for ${mime}.`
    }
    if (totalBytes + encoded > maxTotal) {
        return `Total inline upload size too large (${totalBytes + encoded} bytes), max ${maxTotal} bytes per request.`
    }
    return null
}

function buildMultimodalMessage(
    parts: NativePart[],
    prompt: string
): HumanMessage {
    const content: MessageContentComplex[] = []
    for (const { mimeType, base64Data } of parts) {
        const dataUrl = `data:${mimeType};base64,${base64Data}`
        if (IMAGE_MIME_TYPES.has(mimeType)) {
            content.push({ type: 'image_url', image_url: { url: dataUrl } })
        } else if (mimeType.startsWith('audio/')) {
            content.push({
                type: 'audio_url',
                audio_url: { url: dataUrl, mimeType }
            } as unknown as MessageContentComplex)
        } else if (mimeType.startsWith('video/')) {
            content.push({
                type: 'video_url',
                video_url: { url: dataUrl, mimeType }
            } as unknown as MessageContentComplex)
        } else {
            // Inline data for text/pdf/etc. (Gemini-style)
            content.push({
                inline_data: { mime_type: mimeType, data: base64Data }
            } as unknown as MessageContentComplex)
        }
    }
    if (content.length > 0) content.unshift({ type: 'text', text: prompt })
    return new HumanMessage({ content })
}

function describeTool(config: Config): string {
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
        description: new ReadFilesTool(ctx, config, () => imageUnderstandModel)
            .description,
        selector() {
            return true
        },
        createTool() {
            return new ReadFilesTool(ctx, config, () => imageUnderstandModel)
        }
    })
}
