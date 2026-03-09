import { MessageContentComplex } from '@langchain/core/messages'
import { Context, h, Session } from 'koishi'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'
import { Message } from 'koishi-plugin-chatluna'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type {} from 'koishi-plugin-chatluna-storage-service'
import type {} from 'koishi-plugin-ffmpeg-path'
import { Config, logger } from '..'

const CHATLUNA_DOWNLOAD_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export function apply(ctx: Context, config: Config) {
    if (!config.enableAudioFfmpegConversion) {
        return
    }

    ctx.effect(() =>
        ctx.chatluna.messageTransformer.intercept(
            'audio',
            async (session, element, message, model) => {
                const modelInfo = model
                    ? ctx.chatluna.platform.findModel(model)
                    : undefined

                // If the model doesn't accept audio input, keep fallback path unchanged.
                if (
                    modelInfo?.value?.capabilities?.includes(
                        ModelCapabilities.AudioInput
                    ) === false
                ) {
                    return false
                }

                const sourceUrl = await resolveAudioSourceUrl(
                    ctx,
                    session,
                    element
                )
                if (!sourceUrl) {
                    return false
                }

                const fileName =
                    element.attrs['file'] ??
                    element.attrs['name'] ??
                    element.attrs['filename']

                const fileData = await readFile(ctx, sourceUrl)
                if (!fileData.buffer) {
                    return false
                }

                const converted = await tryConvertAudioToMp3(
                    ctx,
                    fileData.buffer,
                    fileName
                )
                if (!converted) {
                    logger.warn(`Failed to convert audio to MP3: ${sourceUrl}`)
                    return false
                }

                const { fileName: displayFileName, buffer } = converted
                element.attrs['file'] = displayFileName
                element.attrs['filename'] = displayFileName

                const audioUrl = ctx.chatluna_storage
                    ? (element.attrs['chatluna_file_url'] = (
                          await ctx.chatluna_storage.createTempFile(
                              buffer,
                              displayFileName
                          )
                      ).url)
                    : ((element.attrs['chatluna_file_url'] = sourceUrl),
                      `data:audio/mpeg;base64,${buffer.toString('base64')}`)

                ensureContentArray(message, `[voice:${displayFileName}]`)
                ;(message.content as MessageContentComplex[]).push({
                    type: 'audio_url',
                    audio_url: {
                        url: audioUrl,
                        mimeType: 'audio/mpeg'
                    }
                } as unknown as MessageContentComplex)

                logger.debug(
                    `Transcoded unsupported audio to mp3 for multimodal input: ${displayFileName}`
                )
                return true
            },
            100
        )
    )
}

async function resolveAudioSourceUrl(
    ctx: Context,
    session: Session,
    element: h
): Promise<string | null> {
    const srcAttr = (element.attrs['src'] ?? element.attrs['url']) as
        | string
        | undefined
    if (srcAttr?.startsWith('http')) {
        return srcAttr
    }

    if (session.platform !== 'onebot') return srcAttr ?? null

    const fileId = element.attrs['fileId'] ?? element.attrs['fileid']
    if (!fileId) return srcAttr ?? null

    try {
        const bot = session.bot as OneBotBot<Context>
        const busId = element.attrs['busId'] ?? element.attrs['busid']
        return session.isDirect
            ? await bot.internal.getPrivateFileUrl(session.userId, fileId)
            : await bot.internal.getGroupFileUrl(session.guildId, fileId, busId)
    } catch {
        return srcAttr ?? null
    }
}

async function readFile(
    ctx: Context,
    url: string
): Promise<{ buffer: Buffer | null; mimeType: string | null }> {
    const headers = { 'User-Agent': CHATLUNA_DOWNLOAD_USER_AGENT }

    let sanitizedUrl: string
    try {
        const parsed = new URL(url)
        sanitizedUrl = parsed.origin + parsed.pathname
    } catch {
        sanitizedUrl = url
    }

    let mimeTypeFromHead: string | null = null

    // Try HEAD request for size check
    try {
        const headResponse = await ctx.http(url, { method: 'head', headers })
        const headHeaders: Headers = headResponse?.headers
        mimeTypeFromHead =
            headHeaders
                ?.get('content-type')
                ?.split(';')[0]
                ?.trim()
                ?.toLowerCase() ?? null

        const headContentLength = headHeaders?.get('content-length')
            ? Number(headHeaders.get('content-length'))
            : null

        if (
            headContentLength != null &&
            Number.isFinite(headContentLength) &&
            headContentLength > MAX_AUDIO_BYTES
        ) {
            logger.warn(
                `Skip reading oversized audio from ${sanitizedUrl}: ${headContentLength} bytes > ${MAX_AUDIO_BYTES} bytes`
            )
            return { buffer: null, mimeType: mimeTypeFromHead }
        }
    } catch {
        // Some endpoints do not support HEAD; continue with GET safeguards.
    }

    try {
        const response = await fetch(url, { method: 'GET', headers })

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
        }

        const mimeType =
            response.headers
                .get('content-type')
                ?.split(';')[0]
                ?.trim()
                ?.toLowerCase() ?? mimeTypeFromHead
        const responseContentLength = response.headers.get('content-length')
            ? Number(response.headers.get('content-length'))
            : null

        if (
            responseContentLength != null &&
            Number.isFinite(responseContentLength) &&
            responseContentLength > MAX_AUDIO_BYTES
        ) {
            logger.warn(
                `Skip reading oversized audio from ${sanitizedUrl}: ${responseContentLength} bytes > ${MAX_AUDIO_BYTES} bytes`
            )
            return { buffer: null, mimeType }
        }

        if (response.body == null) {
            const arrayBuffer = await response.arrayBuffer()
            if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) {
                logger.warn(
                    `Skip reading oversized audio from ${sanitizedUrl}: ${arrayBuffer.byteLength} bytes > ${MAX_AUDIO_BYTES} bytes`
                )
                return { buffer: null, mimeType }
            }
            return { buffer: Buffer.from(arrayBuffer), mimeType }
        }

        const reader = response.body.getReader()
        const chunks: Buffer[] = []
        let totalBytes = 0

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            if (!value?.byteLength) continue

            totalBytes += value.byteLength
            if (totalBytes > MAX_AUDIO_BYTES) {
                await reader.cancel('audio exceeds max size')
                logger.warn(
                    `Skip reading oversized audio from ${sanitizedUrl}: streamed bytes exceed ${MAX_AUDIO_BYTES} bytes`
                )
                return { buffer: null, mimeType }
            }

            chunks.push(Buffer.from(value))
        }

        return { buffer: Buffer.concat(chunks, totalBytes), mimeType }
    } catch (error) {
        logger.warn(`Failed to read audio from ${sanitizedUrl}:`, error)
        return { buffer: null, mimeType: null }
    }
}

function toMp3FileName(fileName?: string): string {
    const baseName = (fileName ?? 'voice').trim()
    const dotIndex = baseName.lastIndexOf('.')
    return `${dotIndex <= 0 ? baseName : baseName.slice(0, dotIndex)}.mp3`
}

async function tryConvertAudioToMp3(
    ctx: Context,
    inputBuffer: Buffer,
    fileName?: string
): Promise<{ buffer: Buffer; fileName: string } | null> {
    try {
        let sourceBuffer = inputBuffer
        let decodedPcmSampleRate: number | null = null

        if (isSilkAudio(inputBuffer)) {
            const decoded = await decodeSilkAudio(ctx, inputBuffer)
            sourceBuffer = decoded.buffer
            decodedPcmSampleRate = decoded.sampleRate
            logger.debug('Decoded silk audio before mp3 transcoding.')
        }

        const ffmpeg = ctx.ffmpeg
        if (!ffmpeg) {
            throw new Error(
                'FFmpeg service is unavailable. Please enable koishi-plugin-ffmpeg-path.'
            )
        }

        const builder = ffmpeg.builder().input(sourceBuffer)
        if (decodedPcmSampleRate != null) {
            builder.inputOption(
                '-f',
                's16le',
                '-ar',
                String(decodedPcmSampleRate),
                '-ac',
                '1'
            )
        }

        const outputBuffer = await builder
            .outputOption(
                '-vn',
                '-acodec',
                'libmp3lame',
                '-q:a',
                '4',
                '-f',
                'mp3'
            )
            .run('buffer')

        return {
            buffer: outputBuffer,
            fileName: toMp3FileName(fileName)
        }
    } catch (error) {
        logger.warn(
            `Audio transcoding to mp3 failed, fallback to original audio: ${error instanceof Error ? error.message : String(error)}`
        )
        return null
    }
}

function isSilkAudio(inputBuffer: Buffer): boolean {
    if (inputBuffer.length < 9) return false
    const sig = inputBuffer.subarray(0, 9).toString('latin1')
    return (
        sig === '#!SILK_V3' ||
        inputBuffer.subarray(1, 10).toString('latin1') === '#!SILK_V3'
    )
}

async function decodeSilkAudio(
    ctx: Context,
    inputBuffer: Buffer
): Promise<{ buffer: Buffer; sampleRate: number }> {
    const silk = ctx.silk
    if (!silk) {
        throw new Error(
            'Detected silk audio, but no silk service is available for decoding'
        )
    }
    for (const sampleRate of [24000, 16000, 12000, 8000]) {
        try {
            const result = (await silk.decode(
                inputBuffer,
                sampleRate
            )) as DecodeResult

            if (result?.data != null) {
                return { buffer: Buffer.from(result.data), sampleRate }
            }
        } catch {
            continue
        }
    }

    throw new Error('silk decode returned empty output')
}

function ensureContentArray(message: Message, fallbackText: string) {
    if (typeof message.content === 'string') {
        message.content = [
            {
                type: 'text',
                text: message.content.trim().length
                    ? message.content
                    : fallbackText
            }
        ]
    }
}

interface DecodeResult {
    data: Uint8Array
    duration: number
}
