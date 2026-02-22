import { StructuredTool } from '@langchain/core/tools'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { randomUUID } from 'node:crypto'
import z from 'zod'
import {
    MULTIMODAL_PAYLOAD_STORE_KEY,
    MULTIMODAL_PAYLOAD_TTL_MS
} from './constants'

const SUPPORTED_MIME_TYPE_LIST = [
    'text/html',
    'text/css',
    'text/plain',
    'text/markdown',
    'text/xml',
    'text/csv',
    'text/rtf',
    'text/javascript',
    'application/json',
    'image/png',
    'image/jpeg',
    'image/bmp',
    'image/webp',
    'application/pdf',
    'video/mp4',
    'video/mpeg',
    'video/mov',
    'video/avi',
    'video/x-flv',
    'video/mpg',
    'video/webm',
    'video/wmv',
    'video/3gpp',
    'audio/mpeg',
    'audio/mp3',
    'audio/aiff',
    'audio/aac',
    'audio/flac',
    'audio/wav',
    'audio/webm',
    'audio/ogg',
    'audio/mp4'
] as const

type SupportedMimeType = (typeof SUPPORTED_MIME_TYPE_LIST)[number]

type GeminiInlinePart = {
    inlineData: {
        mimeType: SupportedMimeType
        data: string
    }
}

type GeminiToolPart = GeminiInlinePart

type GeminiMultimodalToolPayload = {
    __chatluna_gemini_multimodal_v1: true
    ephemeral: true
    payloadId?: string
    response: {
        files: {
            sourceUrl: string
            mimeType?: SupportedMimeType
            partIndex?: number
            status: 'ok' | 'error'
            error?: string
        }[]
        successCount: number
        failureCount: number
    }
    parts: GeminiToolPart[]
}

const SUPPORTED_MIME_TYPES = new Set<SupportedMimeType>(
    SUPPORTED_MIME_TYPE_LIST
)

const MAX_REQUEST_TOTAL_SIZE_BYTES = 100 * 1024 * 1024
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024
const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024
const MAX_PAYLOAD_STORE_ENTRIES = 2

function classifyGeminiReadFilesError(error: unknown): string {
    const message =
        error instanceof Error ? error.message.toLowerCase() : String(error)

    if (message.includes('only http/https urls are supported')) {
        return 'invalid_url_scheme'
    }
    if (message.includes('unsupported mime type')) {
        return 'unsupported_mime_type'
    }
    if (message.includes('file too large')) {
        return 'file_too_large'
    }
    if (message.includes('total inline upload size too large')) {
        return 'total_size_exceeded'
    }
    if (message.includes('http ')) {
        return 'fetch_failed'
    }

    return 'internal_error'
}

function isHttpOrHttpsUrl(url: string): boolean {
    try {
        const parsed = new URL(url)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
        return false
    }
}

function normalizeMimeType(raw: string | null): SupportedMimeType | null {
    if (raw == null) {
        return null
    }

    const mimeType = raw.split(';')[0]?.trim()?.toLowerCase()
    if (!mimeType || !SUPPORTED_MIME_TYPES.has(mimeType as SupportedMimeType)) {
        return null
    }

    return mimeType as SupportedMimeType
}

function inferMimeTypeFromUrl(url: string): SupportedMimeType | null {
    try {
        const pathname = new URL(url).pathname.toLowerCase()
        if (pathname.endsWith('.png')) return 'image/png'
        if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
            return 'image/jpeg'
        }
        if (pathname.endsWith('.bmp')) return 'image/bmp'
        if (pathname.endsWith('.webp')) return 'image/webp'
        if (pathname.endsWith('.pdf')) return 'application/pdf'
        if (pathname.endsWith('.txt')) return 'text/plain'
        if (pathname.endsWith('.md')) return 'text/markdown'
        if (pathname.endsWith('.html') || pathname.endsWith('.htm')) {
            return 'text/html'
        }
        if (pathname.endsWith('.css')) return 'text/css'
        if (pathname.endsWith('.xml')) return 'text/xml'
        if (pathname.endsWith('.csv')) return 'text/csv'
        if (pathname.endsWith('.rtf')) return 'text/rtf'
        if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) {
            return 'text/javascript'
        }
        if (pathname.endsWith('.json')) return 'application/json'
        if (pathname.endsWith('.mp4')) return 'video/mp4'
        if (pathname.endsWith('.mpeg')) return 'video/mpeg'
        if (pathname.endsWith('.mov')) return 'video/mov'
        if (pathname.endsWith('.avi')) return 'video/avi'
        if (pathname.endsWith('.flv')) return 'video/x-flv'
        if (pathname.endsWith('.mpg')) return 'video/mpg'
        if (pathname.endsWith('.webm')) return 'video/webm'
        if (pathname.endsWith('.wmv')) return 'video/wmv'
        if (pathname.endsWith('.3gp') || pathname.endsWith('.3gpp')) {
            return 'video/3gpp'
        }
        if (pathname.endsWith('.mp3')) return 'audio/mpeg'
        if (pathname.endsWith('.aiff')) return 'audio/aiff'
        if (pathname.endsWith('.aac')) return 'audio/aac'
        if (pathname.endsWith('.flac')) return 'audio/flac'
        if (pathname.endsWith('.wav')) return 'audio/wav'
        if (pathname.endsWith('.ogg')) return 'audio/ogg'
        if (pathname.endsWith('.m4a')) return 'audio/mp4'
    } catch {}

    return null
}

function getMultimodalPayloadStore(): Map<
    string,
    { parts: GeminiToolPart[]; createdAt: number }
> {
    const g = globalThis as Record<string, unknown>
    if (!(g[MULTIMODAL_PAYLOAD_STORE_KEY] instanceof Map)) {
        g[MULTIMODAL_PAYLOAD_STORE_KEY] = new Map()
    }

    return g[MULTIMODAL_PAYLOAD_STORE_KEY] as Map<
        string,
        { parts: GeminiToolPart[]; createdAt: number }
    >
}

function getBase64EncodedSize(rawBytes: number): number {
    if (!Number.isFinite(rawBytes) || rawBytes <= 0) {
        return 0
    }
    return Math.ceil(rawBytes / 3) * 4
}

function putMultimodalPayloadParts(parts: GeminiToolPart[]): string {
    const store = getMultimodalPayloadStore()
    const now = Date.now()
    for (const [key, value] of store.entries()) {
        if (now - value.createdAt > MULTIMODAL_PAYLOAD_TTL_MS) {
            store.delete(key)
        }
    }
    while (store.size >= MAX_PAYLOAD_STORE_ENTRIES) {
        let oldestKey: string | undefined
        let oldestCreatedAt = Number.POSITIVE_INFINITY
        for (const [key, value] of store.entries()) {
            if (value.createdAt < oldestCreatedAt) {
                oldestCreatedAt = value.createdAt
                oldestKey = key
            }
        }
        if (oldestKey == null) {
            break
        }
        store.delete(oldestKey)
    }

    const id = randomUUID()
    store.set(id, {
        parts,
        createdAt: now
    })
    return id
}

export class GeminiReadFilesTool extends StructuredTool {
    name = 'gemini_read_files'

    description = `Read file URL(s) and return multimodal function response payload.
Supported MIME types:
- Text: text/html, text/css, text/plain, text/markdown, text/xml, text/csv, text/rtf, text/javascript
- Application: application/json, application/pdf
- Image: image/bmp, image/jpeg, image/png, image/webp
- Audio: audio/mpeg, audio/mp3, audio/aiff, audio/aac, audio/flac, audio/wav, audio/webm, audio/ogg, audio/mp4
- Video: video/mp4, video/mpeg, video/mov, video/avi, video/x-flv, video/mpg, video/webm, video/wmv, video/3gpp
Limits: PDF per-file 50MB, other files per-file 100MB, total 100MB per request.
Use this tool when you need files from URL(s) as inline multimodal context for the current turn only.`

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
                'One URL or a list of URLs to read. Uses inlineData for this round only and accepts official Gemini-supported MIME types.'
            )
    })

    constructor(private readonly plugin: ChatLunaPlugin) {
        super({})
    }

    async _call(input: z.infer<typeof this.schema>, _) {
        const urls = Array.isArray(input.urls) ? input.urls : [input.urls]
        let totalBase64Bytes = 0

        const payload: GeminiMultimodalToolPayload = {
            __chatluna_gemini_multimodal_v1: true,
            ephemeral: true,
            response: {
                files: [],
                successCount: 0,
                failureCount: 0
            },
            parts: []
        }

        for (let index = 0; index < urls.length; index++) {
            const sourceUrl = urls[index]
            try {
                if (!isHttpOrHttpsUrl(sourceUrl)) {
                    throw new Error(
                        'Only http/https URLs are supported for gemini_read_files.'
                    )
                }

                const response = await this.plugin.fetch(sourceUrl)
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`)
                }

                const mimeType =
                    normalizeMimeType(response.headers.get('content-type')) ??
                    inferMimeTypeFromUrl(sourceUrl)

                if (!mimeType) {
                    throw new Error(
                        'Unsupported MIME type for inline upload. Please ensure URL returns a Gemini-supported type.'
                    )
                }

                const maxSize =
                    mimeType === 'application/pdf'
                        ? MAX_PDF_SIZE_BYTES
                        : MAX_FILE_SIZE_BYTES
                const remainingBytes =
                    MAX_REQUEST_TOTAL_SIZE_BYTES - totalBase64Bytes
                const contentLengthHeader =
                    response.headers.get('content-length')
                const contentLength =
                    contentLengthHeader == null
                        ? NaN
                        : Number(contentLengthHeader)

                if (Number.isFinite(contentLength) && contentLength > 0) {
                    const encodedContentLength =
                        getBase64EncodedSize(contentLength)
                    if (encodedContentLength > maxSize) {
                        throw new Error(
                            `File too large after base64 encoding (${encodedContentLength} bytes), max ${maxSize} bytes for ${mimeType}`
                        )
                    }
                    if (encodedContentLength > remainingBytes) {
                        const predictedTotal =
                            totalBase64Bytes + encodedContentLength
                        throw new Error(
                            `Total inline upload size too large (${predictedTotal} bytes), max ${MAX_REQUEST_TOTAL_SIZE_BYTES} bytes per request`
                        )
                    }
                }

                const fileBytes = Buffer.from(await response.arrayBuffer())
                const base64Data = fileBytes.toString('base64')
                const encodedFileBytes = base64Data.length

                if (encodedFileBytes > maxSize) {
                    throw new Error(
                        `File too large after base64 encoding (${encodedFileBytes} bytes), max ${maxSize} bytes for ${mimeType}`
                    )
                }

                const newTotalBytes = totalBase64Bytes + encodedFileBytes
                if (newTotalBytes > MAX_REQUEST_TOTAL_SIZE_BYTES) {
                    throw new Error(
                        `Total inline upload size too large (${newTotalBytes} bytes), max ${MAX_REQUEST_TOTAL_SIZE_BYTES} bytes per request`
                    )
                }
                totalBase64Bytes = newTotalBytes

                payload.parts.push({
                    inlineData: {
                        mimeType,
                        data: base64Data
                    }
                })

                payload.response.files.push({
                    sourceUrl,
                    mimeType,
                    partIndex: payload.parts.length - 1,
                    status: 'ok'
                })
                payload.response.successCount++
            } catch (error) {
                payload.response.files.push({
                    sourceUrl,
                    status: 'error',
                    error: classifyGeminiReadFilesError(error)
                })
                payload.response.failureCount++
            }
        }

        if (payload.parts.length > 0) {
            payload.payloadId = putMultimodalPayloadParts(payload.parts)
            payload.parts = []
        }

        return JSON.stringify(payload)
    }
}
