import { createHash } from 'node:crypto'
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
import fileType from 'file-type'

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

export async function detectFileType(
    buffer: Buffer
): Promise<{ mime: string; ext: string } | undefined> {
    const result = await fileType.fromBuffer(buffer)
    if (!result) return undefined
    return { mime: result.mime, ext: result.ext }
}

/**
 * Detect audio MIME from buffer header. Recognises QQ Silk + AMR, then uses
 * file-type and falls back to the declared MIME otherwise.
 */
export async function detectAudioMimeType(
    buffer: Buffer,
    declared?: string | null
): Promise<string | null> {
    const head = buffer.subarray(0, 16).toString('latin1')

    if (head.startsWith('#!AMR')) return 'audio/amr'
    // QQ/OneBot ships SILK voice files with a leading flag byte before the
    // standard `#!SILK_V3` magic, so we also check offset 1 for that variant.
    if (
        head.startsWith('#!SILK_V3') ||
        buffer.subarray(1, 10).toString('latin1') === '#!SILK_V3'
    ) {
        return 'audio/silk'
    }

    return (await detectFileType(buffer))?.mime ?? declared ?? null
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
        // Match both the standard SILK magic and the QQ/OneBot variant that
        // prepends a flag byte before `#!SILK_V3`.
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
// Image description cache
// ---------------------------------------------------------------------------

const DESC_TTL = 5 * 60 * 1000
const DESC_MAX = 100

const descs = new Map<string, { text: string; exp: number }>()
const descPending = new Map<string, Promise<string | undefined>>()

export async function singleFlight<T>(
    pending: Map<string, Promise<T>>,
    key: string | undefined,
    load: () => Promise<T>
): Promise<T> {
    if (key == null) return load()
    const existing = pending.get(key)
    if (existing != null) return existing
    const task = (async () => {
        try {
            return await load()
        } finally {
            pending.delete(key)
        }
    })()
    pending.set(key, task)
    return task
}

export async function getOrDescribeImage(
    scope: string | undefined,
    buffer: Buffer,
    config: Config,
    describe: () => Promise<string | null>
): Promise<string | undefined> {
    const wrap = (text: string) =>
        config.imageInsertPrompt.replace('{img}', text)

    if (scope == null) {
        const text = await describe()
        return text == null || text.length < 1 ? undefined : wrap(text)
    }

    const hash = createHash('sha256').update(buffer).digest('hex')
    const key = `${hash}\0${config.imageModel}\0${config.imagePrompt}\0${config.gifStrategy}\0${config.gifFrameCount}`

    const hit = descs.get(key)
    if (hit != null) {
        if (hit.exp <= Date.now()) descs.delete(key)
        else {
            descs.delete(key)
            descs.set(key, hit)
            return wrap(hit.text)
        }
    }

    let pending = descPending.get(key)
    if (pending == null) {
        pending = (async () => {
            try {
                const text = await describe()
                if (text == null || text.length < 1) return undefined
                descs.delete(key)
                descs.set(key, { text, exp: Date.now() + DESC_TTL })
                if (descs.size > DESC_MAX) {
                    descs.delete(descs.keys().next().value!)
                }
                return text
            } finally {
                descPending.delete(key)
            }
        })()
        descPending.set(key, pending)
    }
    const text = await pending
    return text == null ? undefined : wrap(text)
}

export async function buildDescribeMessage(
    buffer: Buffer,
    mime: string,
    config: Config
): Promise<Message> {
    const msg: Message = { content: [] }
    if (mime === 'image/gif') {
        addTextToContent(msg, 'This is a GIF image. See the frames below:')
        for (const frame of await parseGifToFrames(buffer, {
            strategy: config.gifStrategy,
            frameCount: config.gifFrameCount
        })) {
            addImageToContent(msg, frame)
        }
    } else {
        addImageToContent(
            msg,
            `data:${mime};base64,${buffer.toString('base64')}`
        )
    }
    return msg
}

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
    const items = Array.isArray(message.content) ? message.content : []
    if (!items.some((item) => isMessageContentImageUrl(item))) return null

    try {
        const content: MessageContentComplex[] = [
            { type: 'text', text: config.imagePrompt } as MessageContentText,
            ...items
        ]
        const result = await model.invoke([new HumanMessage({ content })])
        const text = getMessageContent(result.content)
        return text.length > 0 ? text : null
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
