import { MessageContentComplex } from '@langchain/core/messages'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
    mkdtemp,
    readFile as fsReadFile,
    rm,
    writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, h, Session } from 'koishi'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'
import { Message } from 'koishi-plugin-chatluna'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { getMimeTypeFromSource } from 'koishi-plugin-chatluna/utils/string'
import type {} from 'koishi-plugin-chatluna-storage-service'
import { Config, logger } from '..'

const CHATLUNA_DOWNLOAD_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const CHATLUNA_FFMPEG_TIMEOUT_MS = 30_000
const CHATLUNA_FFMPEG_STDERR_MAX_CHARS = 64 * 1024
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

// Keep this list aligned with core native audio support.
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

export function apply(ctx: Context, config: Config) {
    if (!config.enableAudioFfmpegConversion) {
        return
    }

    const disposable = ctx.chatluna.messageTransformer.intercept(
        'audio',
        async (session, element, message, model) => {
            const parsedModelInfo =
                model != null
                    ? ctx.chatluna.platform.findModel(model)
                    : undefined

            // If the model doesn't accept audio input, keep fallback path unchanged.
            if (
                parsedModelInfo?.value != null &&
                !parsedModelInfo.value.capabilities.includes(
                    ModelCapabilities.AudioInput
                )
            ) {
                return false
            }

            const sourceUrl = await resolveAudioSourceUrl(ctx, session, element)
            if (sourceUrl == null) {
                return false
            }

            const fileName =
                element.attrs['file'] ??
                element.attrs['name'] ??
                element.attrs['filename']

            const fileData = await readFile(ctx, sourceUrl)
            if (fileData.buffer == null) {
                return false
            }

            const mimeType =
                fileData.mimeType?.split(';')[0]?.trim()?.toLowerCase() ??
                getMimeTypeFromSource(sourceUrl, fileName)

            if (mimeType != null && SUPPORTED_AUDIO_MIME_TYPES.has(mimeType)) {
                // Native supported audio type: keep existing path.
                return false
            }

            const converted = await tryConvertAudioToMp3(
                fileData.buffer,
                fileName
            )
            if (converted == null) {
                return false
            }

            const displayFileName = converted.fileName
            element.attrs['file'] = displayFileName
            element.attrs['filename'] = displayFileName

            let audioUrl: string
            if (ctx.chatluna_storage) {
                const file = await ctx.chatluna_storage.createTempFile(
                    converted.buffer,
                    displayFileName
                )
                audioUrl = file.url
                element.attrs['chatluna_file_url'] = file.url
            } else {
                const base64 = converted.buffer.toString('base64')
                audioUrl = `data:audio/mpeg;base64,${base64}`
                element.attrs['chatluna_file_url'] = sourceUrl
            }

            ensureContentArray(message, `[Voice:${displayFileName}]`)
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

    ctx.effect(() => disposable)
}

async function resolveAudioSourceUrl(
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

    const fileId = element.attrs['fileId'] ?? element.attrs['fileid']
    if (session.platform === 'onebot' && fileId) {
        try {
            const bot = session.bot as OneBotBot<Context>
            const busId = element.attrs['busId'] ?? element.attrs['busid']

            if (session.isDirect) {
                return await bot.internal.getPrivateFileUrl(
                    session.userId,
                    fileId
                )
            }

            return await bot.internal.getGroupFileUrl(
                session.guildId,
                fileId,
                busId
            )
        } catch {
            // fallback to raw src
        }
    }

    return srcAttr ?? null
}

async function readFile(
    ctx: Context,
    url: string
): Promise<{ buffer: Buffer | null; mimeType: string | null }> {
    const headers = {
        'User-Agent': CHATLUNA_DOWNLOAD_USER_AGENT
    }

    let mimeTypeFromHead: string | null = null

    try {
        const headResponse = await ctx.http(url, {
            method: 'head',
            headers
        })

        const headHeaders: Headers = headResponse?.headers
        mimeTypeFromHead =
            headHeaders
                ?.get('content-type')
                ?.split(';')[0]
                ?.trim()
                ?.toLowerCase() ?? null
        const headContentLengthRaw = headHeaders?.get('content-length')
        const headContentLength =
            headContentLengthRaw != null ? Number(headContentLengthRaw) : null
        if (
            headContentLength != null &&
            Number.isFinite(headContentLength) &&
            headContentLength > MAX_AUDIO_BYTES
        ) {
            logger.warn(
                `Skip reading oversized audio from ${url}: ${headContentLength} bytes > ${MAX_AUDIO_BYTES} bytes`
            )
            return { buffer: null, mimeType: mimeTypeFromHead }
        }
    } catch {
        // Some endpoints do not support HEAD; continue with GET safeguards.
    }

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers
        })

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
        }

        const mimeType =
            response.headers
                .get('content-type')
                ?.split(';')[0]
                ?.trim()
                ?.toLowerCase() ?? mimeTypeFromHead
        const responseContentLengthRaw = response.headers.get('content-length')
        const responseContentLength =
            responseContentLengthRaw != null
                ? Number(responseContentLengthRaw)
                : null
        if (
            responseContentLength != null &&
            Number.isFinite(responseContentLength) &&
            responseContentLength > MAX_AUDIO_BYTES
        ) {
            logger.warn(
                `Skip reading oversized audio from ${url}: ${responseContentLength} bytes > ${MAX_AUDIO_BYTES} bytes`
            )
            return { buffer: null, mimeType }
        }

        if (response.body == null) {
            const arrayBuffer = await response.arrayBuffer()
            if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) {
                logger.warn(
                    `Skip reading oversized audio from ${url}: ${arrayBuffer.byteLength} bytes > ${MAX_AUDIO_BYTES} bytes`
                )
                return { buffer: null, mimeType }
            }

            return {
                buffer: Buffer.from(arrayBuffer),
                mimeType
            }
        }

        const reader = response.body.getReader()
        const chunks: Buffer[] = []
        let totalBytes = 0

        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                break
            }

            if (value == null || value.byteLength === 0) {
                continue
            }

            totalBytes += value.byteLength
            if (totalBytes > MAX_AUDIO_BYTES) {
                await reader.cancel('audio exceeds max size')
                logger.warn(
                    `Skip reading oversized audio from ${url}: streamed bytes exceed ${MAX_AUDIO_BYTES} bytes`
                )
                return { buffer: null, mimeType }
            }

            chunks.push(Buffer.from(value))
        }

        return {
            buffer: Buffer.concat(chunks, totalBytes),
            mimeType
        }
    } catch (error) {
        logger.warn(`Failed to read audio from ${url}:`, error)
        return { buffer: null, mimeType: null }
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
    fileName?: string
): Promise<{ buffer: Buffer; fileName: string } | null> {
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

    return await new Promise((resolve, reject) => {
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
