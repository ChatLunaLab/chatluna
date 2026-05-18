import {
    HumanMessage,
    MessageContentComplex,
    MessageContentText
} from '@langchain/core/messages'
import { Message } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    getImageType,
    getMessageContent,
    isMessageContentImageUrl
} from 'koishi-plugin-chatluna/utils/string'
import { Context } from 'koishi'
import type {} from 'koishi-plugin-ffmpeg-path'
import { Config, logger } from '.'
import { GifReader } from 'omggif'
import { Jimp } from 'jimp'

// ---------------------------------------------------------------------------
// MIME helpers
// ---------------------------------------------------------------------------

export const IMAGE_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/bmp',
    'image/webp',
    'image/gif'
])

const FILE_EXTENSION_TO_MIME_TYPE: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.xml': 'text/xml',
    '.csv': 'text/csv',
    '.rtf': 'text/rtf',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.mp4': 'video/mp4',
    '.mpeg': 'video/mpeg',
    '.mov': 'video/mov',
    '.avi': 'video/avi',
    '.flv': 'video/x-flv',
    '.webm': 'video/webm',
    '.wmv': 'video/wmv',
    '.3gp': 'video/3gpp',
    '.3gpp': 'video/3gpp',
    '.mp3': 'audio/mpeg',
    '.aiff': 'audio/aiff',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4'
}

export function inferMimeTypeFromUrl(url: string): string | null {
    try {
        const path = new URL(url).pathname.toLowerCase()
        const dot = path.lastIndexOf('.')
        return dot < 0
            ? null
            : (FILE_EXTENSION_TO_MIME_TYPE[path.slice(dot)] ?? null)
    } catch {
        return null
    }
}

export function normalizeMimeType(
    raw: string | null | undefined
): string | null {
    return raw?.split(';')[0]?.trim()?.toLowerCase() || null
}

/**
 * Detect audio MIME from buffer header. Recognises QQ Silk + AMR + common
 * audio container magic bytes. Falls back to the declared MIME otherwise.
 */
export function detectAudioMimeType(
    buffer: Buffer,
    declared?: string | null
): string | null {
    const head = buffer.subarray(0, 16).toString('latin1')

    if (head.startsWith('#!AMR')) return 'audio/amr'
    if (
        head.startsWith('#!SILK_V3') ||
        buffer.subarray(1, 10).toString('latin1') === '#!SILK_V3'
    ) {
        return 'audio/silk'
    }
    // MP3 frame sync: 0xFFEx. Reject JPEG (0xFFD8) by checking the full sync word.
    if (
        head.startsWith('ID3') ||
        (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    ) {
        return 'audio/mpeg'
    }
    if (
        head.startsWith('RIFF') &&
        buffer.subarray(8, 12).toString('latin1') === 'WAVE'
    ) {
        return 'audio/wav'
    }
    if (head.startsWith('fLaC')) return 'audio/flac'
    if (head.startsWith('OggS')) return 'audio/ogg'

    return declared ?? null
}

// ---------------------------------------------------------------------------
// FFmpeg / Silk
// ---------------------------------------------------------------------------

export async function convertAudioToMp3(
    ctx: Context,
    buffer: Buffer
): Promise<Buffer | null> {
    if (!ctx.ffmpeg) {
        logger.warn(
            'FFmpeg service unavailable; install koishi-plugin-ffmpeg-path to enable audio transcoding.'
        )
        return null
    }

    try {
        const isSilk =
            buffer.subarray(0, 9).toString('latin1') === '#!SILK_V3' ||
            buffer.subarray(1, 10).toString('latin1') === '#!SILK_V3'

        let source = buffer
        let silkSampleRate: number | null = null
        if (isSilk) {
            const decoded = await decodeSilkToPcm(ctx, buffer)
            if (!decoded) return null
            source = decoded.buffer
            silkSampleRate = decoded.sampleRate
        }

        const builder = ctx.ffmpeg.builder().input(source)
        if (silkSampleRate != null) {
            builder.inputOption(
                '-f',
                's16le',
                '-ar',
                String(silkSampleRate),
                '-ac',
                '1'
            )
        }
        return await builder
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
    } catch (error) {
        logger.warn(`Audio transcoding to mp3 failed:`, error)
        return null
    }
}

async function decodeSilkToPcm(
    ctx: Context,
    buffer: Buffer
): Promise<{ buffer: Buffer; sampleRate: number } | null> {
    if (!ctx.silk) {
        logger.warn(
            'Silk service unavailable; install koishi-plugin-ffmpeg-path 2.0+ for silk decoding.'
        )
        return null
    }
    for (const sampleRate of [24000, 16000, 12000, 8000]) {
        try {
            const result = (await ctx.silk.decode(buffer, sampleRate)) as {
                data?: Uint8Array
            }
            if (result?.data != null) {
                return { buffer: Buffer.from(result.data), sampleRate }
            }
        } catch {
            // try next sample rate
        }
    }
    return null
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

export interface GifExtractionConfig {
    strategy: 'first' | 'head' | 'average'
    frameCount: number
}

export async function parseGifToFrames(
    buffer: Buffer,
    config: GifExtractionConfig
): Promise<string[]> {
    const reader = new GifReader(buffer)
    const total = reader.numFrames()
    if (total === 0) throw new Error('No frames found in GIF')

    const indices = pickGifFrameIndices(total, config)
    const { width, height } = reader
    const canvas = new Uint8ClampedArray(width * height * 4)
    let lastDecoded = -1
    const frames: string[] = []

    for (const idx of indices) {
        const needsFullDecode =
            idx < lastDecoded ||
            (lastDecoded >= 0 && hasComplexDisposal(reader, lastDecoded, idx))
        if (needsFullDecode) {
            canvas.fill(0)
            for (let i = 0; i <= idx; i++)
                reader.decodeAndBlitFrameRGBA(i, canvas)
        } else {
            for (let i = lastDecoded + 1; i <= idx; i++) {
                reader.decodeAndBlitFrameRGBA(i, canvas)
            }
        }
        lastDecoded = idx

        const png = await new Jimp({
            data: Buffer.from(new Uint8ClampedArray(canvas)),
            width,
            height
        }).getBuffer('image/png')
        frames.push(`data:image/png;base64,${png.toString('base64')}`)
    }
    return frames
}

function pickGifFrameIndices(
    total: number,
    config: GifExtractionConfig
): number[] {
    if (config.strategy === 'first') return [0]
    const count = Math.min(config.frameCount, total)
    if (config.strategy === 'head') {
        return Array.from({ length: count }, (_, i) => i)
    }
    // average
    if (count >= total) return Array.from({ length: total }, (_, i) => i)
    if (count === 1) return [0]
    const step = (total - 1) / (count - 1)
    return Array.from({ length: count }, (_, i) => Math.floor(i * step))
}

function hasComplexDisposal(
    reader: GifReader,
    start: number,
    end: number
): boolean {
    for (let i = start; i < end; i++) {
        const d = reader.frameInfo(i).disposal
        if (d === 2 || d === 3) return true
    }
    return false
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export async function readImage(ctx: Context, url: string) {
    if (url.startsWith('data:image') && url.includes('base64')) {
        const buffer = Buffer.from(url.split(',')[1], 'base64')
        return { base64Source: url, buffer, ext: getImageType(buffer) }
    }
    try {
        const { data } = await ctx.http(url, {
            responseType: 'arraybuffer',
            method: 'get',
            headers: { 'User-Agent': BROWSER_UA }
        })
        const buffer = Buffer.from(data)
        const ext = getImageType(buffer)
        return {
            base64Source: `data:${ext};base64,${buffer.toString('base64')}`,
            buffer,
            ext
        }
    } catch (error) {
        logger.error(`Failed to read image from ${url}:`, error)
        return { base64Source: null, buffer: null, ext: null }
    }
}

export async function processImageWithModel(
    model: ChatLunaChatModel,
    config: Config,
    message: Message
): Promise<string | null> {
    const images = Array.isArray(message.content)
        ? message.content.filter((item: MessageContentComplex) =>
              isMessageContentImageUrl(item)
          )
        : []
    if (images.length === 0) return null

    try {
        const content: MessageContentComplex[] = [
            { type: 'text', text: config.imagePrompt } as MessageContentText,
            ...images
        ]
        const result = await model.invoke([new HumanMessage({ content })])
        return config.imageInsertPrompt.replace(
            '{img}',
            getMessageContent(result.content)
        )
    } catch (error) {
        logger.warn('Failed to process image with model', error)
        return null
    }
}

export function addImageToContent(message: Message, imageUrl: string) {
    ensureContentArray(message)
    ;(message.content as MessageContentComplex[]).push({
        type: 'image_url',
        image_url: { url: imageUrl }
    })
}

export function addTextToContent(message: Message, text: string) {
    if (typeof message.content === 'string') {
        message.content += text
        return
    }
    const content = message.content as MessageContentComplex[]
    const last = content[content.length - 1]
    if (last && last.type === 'text') {
        last.text += text
    } else {
        content.push({ type: 'text', text })
    }
}

export function ensureContentArray(message: Message, fallbackText = '') {
    if (typeof message.content !== 'string') return
    message.content = message.content.length
        ? [{ type: 'text', text: message.content }]
        : fallbackText.length
          ? [{ type: 'text', text: fallbackText }]
          : []
}

export const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
