import { MessageContentComplex } from '@langchain/core/messages'
import { Context, h, Session } from 'koishi'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type {} from 'koishi-plugin-ffmpeg-path'
import { Config, logger } from '..'
import {
    BROWSER_UA,
    convertAudioToMp3,
    detectAudioMimeType,
    ensureContentArray
} from '../utils'

// MIMEs commonly accepted by OpenAI / Gemini / MiMo audio inputs. Anything
// else (Silk, AMR, ...) is transcoded to MP3.
const NATIVE_AUDIO_MIMES = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/flac',
    'audio/ogg',
    'audio/mp4',
    'audio/aac',
    'audio/webm'
])

const MIME_TO_EXT: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/flac': 'flac',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/webm': 'webm'
}

/**
 * Intercept voice/audio elements: download, transcode unfriendly formats
 * (Silk/AMR/...) to MP3, then inject as a Base64 `audio_url` content part.
 * OpenAI-compatible adapters convert the result to `input_audio` downstream.
 */
export function apply(ctx: Context, config: Config) {
    if (!config.enableAudioFfmpegConversion) return

    ctx.effect(() =>
        ctx.chatluna.messageTransformer.intercept(
            'audio',
            async (session, element, message, model) => {
                if (!modelAcceptsAudio(ctx, model)) return false

                const sourceUrl = await resolveAudioSourceUrl(session, element)
                if (!sourceUrl) return false

                const buffer = await downloadAudio(ctx, sourceUrl)
                if (!buffer) return false

                const detected = await detectAudioMimeType(
                    buffer,
                    element.attrs['mime'] as string | null
                )

                if (detected && NATIVE_AUDIO_MIMES.has(detected)) {
                    return false
                }

                const converted = await convertAudioToMp3(ctx, buffer)
                if (!converted) {
                    logger.warn(
                        `Skip audio: format ${detected ?? 'unknown'} not natively supported and ffmpeg conversion failed.`
                    )
                    return false
                }

                const dataUrl = `data:audio/mpeg;base64,${converted.toString('base64')}`
                const ext = MIME_TO_EXT['audio/mpeg']
                const fileName = `${stripExtension(audioName(element))}.${ext}`
                element.attrs['file'] = fileName
                element.attrs['filename'] = fileName
                element.attrs['chatluna_file_url'] = sourceUrl

                ensureContentArray(message)
                ;(message.content as MessageContentComplex[]).push({
                    type: 'audio_url',
                    audio_url: { url: dataUrl, mimeType: 'audio/mpeg' }
                } as unknown as MessageContentComplex)

                logger.debug(
                    `Injected audio for ${model}: ${fileName} (audio/mpeg, ${converted.byteLength} bytes)`
                )
                return false
            },
            100
        )
    )
}

function modelAcceptsAudio(ctx: Context, model: string | undefined): boolean {
    if (!model) return false
    return (
        ctx.chatluna.platform
            .findModel(model)
            ?.value?.capabilities?.includes(ModelCapabilities.AudioInput) ===
        true
    )
}

async function resolveAudioSourceUrl(
    session: Session,
    element: h
): Promise<string | null> {
    const src = (element.attrs['src'] ?? element.attrs['url']) as
        string | undefined
    if (src?.startsWith('http')) return src
    if (session.platform !== 'onebot') return src ?? null

    const fileId = element.attrs['fileId'] ?? element.attrs['fileid']
    if (!fileId) return src ?? null

    try {
        const bot = session.bot as OneBotBot<Context>
        const busId = element.attrs['busId'] ?? element.attrs['busid']
        return session.isDirect
            ? await bot.internal.getPrivateFileUrl(session.userId, fileId)
            : await bot.internal.getGroupFileUrl(session.guildId, fileId, busId)
    } catch {
        return src ?? null
    }
}

async function downloadAudio(
    ctx: Context,
    url: string
): Promise<Buffer | null> {
    try {
        const { data } = await ctx.http(url, {
            responseType: 'arraybuffer',
            method: 'get',
            headers: { 'User-Agent': BROWSER_UA }
        })
        return Buffer.from(data)
    } catch (error) {
        logger.warn(`Failed to fetch audio from ${url}:`, error)
        return null
    }
}

function audioName(element: h): string {
    return (
        (element.attrs['file'] as string | undefined) ??
        (element.attrs['name'] as string | undefined) ??
        (element.attrs['filename'] as string | undefined) ??
        'voice'
    )
}

function stripExtension(name: string): string {
    const dot = name.lastIndexOf('.')
    return dot > 0 ? name.slice(0, dot) : name
}
