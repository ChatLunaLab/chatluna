import { BaseMessage } from '@langchain/core/messages'
import { FilePayload, InputFileObject, UploadCandidate } from './types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import path from 'path'
import fs from 'fs'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { logger } from '.'

export function guessMimeType(
    extension?: string,
    fallback: string = 'application/octet-stream'
) {
    if (!extension) {
        return fallback
    }

    const normalized = extension.startsWith('.')
        ? extension.substring(1)
        : extension

    switch (normalized.toLowerCase()) {
        case 'png':
            return 'image/png'
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg'
        case 'gif':
            return 'image/gif'
        case 'webp':
            return 'image/webp'
        case 'bmp':
            return 'image/bmp'
        case 'svg':
            return 'image/svg+xml'
        case 'pdf':
            return 'application/pdf'
        case 'txt':
            return 'text/plain'
        case 'md':
            return 'text/markdown'
        case 'mp3':
            return 'audio/mpeg'
        case 'wav':
            return 'audio/wav'
        case 'ogg':
            return 'audio/ogg'
        case 'mp4':
            return 'video/mp4'
        case 'mov':
            return 'video/quicktime'
        default:
            return fallback
    }
}

export function guessExtensionFromMime(mimeType?: string) {
    if (!mimeType) {
        return 'bin'
    }

    switch (mimeType) {
        case 'image/png':
            return 'png'
        case 'image/jpeg':
            return 'jpg'
        case 'image/gif':
            return 'gif'
        case 'image/webp':
            return 'webp'
        case 'image/svg+xml':
            return 'svg'
        case 'application/pdf':
            return 'pdf'
        case 'text/plain':
            return 'txt'
        case 'text/markdown':
            return 'md'
        case 'audio/mpeg':
            return 'mp3'
        case 'audio/wav':
            return 'wav'
        case 'audio/ogg':
            return 'ogg'
        case 'video/mp4':
            return 'mp4'
        case 'video/quicktime':
            return 'mov'
        default:
            if (mimeType.startsWith('image/')) {
                return mimeType.split('/')[1] ?? 'img'
            }
            return 'bin'
    }
}

export function buildFallbackFileName(mimeType?: string) {
    const ext = guessExtensionFromMime(mimeType)
    return `chatluna_file.${ext}`
}

export function convertToBuffer(
    source: ArrayBuffer | Uint8Array | Buffer
): Buffer | null {
    if (source instanceof Buffer) {
        return source
    }

    if (source instanceof ArrayBuffer) {
        return Buffer.from(source)
    }

    if (ArrayBuffer.isView(source)) {
        return Buffer.from(source.buffer, source.byteOffset, source.byteLength)
    }

    return null
}

export function mapMimeToFileType(
    mimeType?: string
): InputFileObject['type'] | undefined {
    if (!mimeType) {
        return undefined
    }

    if (mimeType.startsWith('image/')) {
        return 'image'
    }

    if (mimeType.startsWith('audio/')) {
        return 'audio'
    }

    if (mimeType.startsWith('video/')) {
        return 'video'
    }

    if (
        mimeType.startsWith('text/') ||
        mimeType === 'application/pdf' ||
        mimeType === 'application/msword' ||
        mimeType ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
        return 'document'
    }

    return 'custom'
}

export function safeSerializeMultimodal(
    lastMessage?: BaseMessage,
    candidates: UploadCandidate[] = []
): string | undefined {
    if (!lastMessage) {
        return undefined
    }

    try {
        const summary = {
            has_files: candidates.length > 0,
            file_count: candidates.length,
            // 只保留类型和（可选）截断后的字符串来源，避免超长
            files: candidates.slice(0, 5).map((c, index) => {
                const type = c.type ?? 'file'
                let source: string | undefined
                if (typeof c.source === 'string') {
                    source = c.source.slice(0, 64)
                }
                return {
                    idx: index,
                    type,
                    source
                }
            })
        }

        let result = JSON.stringify(summary)

        if (result.length > 256) {
            result = result.slice(0, 255)
        }

        return result
    } catch (error) {
        logger.warn('Failed to serialize chatluna_multimodal payload', error)
        return undefined
    }
}

export async function resolveFilePayload(
    plugin: ChatLunaPlugin,
    candidate: UploadCandidate,
    signal?: AbortSignal
): Promise<FilePayload | null> {
    const { source, fileName, mimeType } = candidate

    if (typeof source === 'string') {
        const dataUrlPayload = tryParseDataUrl(source, fileName, mimeType)
        if (dataUrlPayload) {
            return dataUrlPayload
        }

        const localFilePayload = await tryReadLocalFile(
            source,
            fileName,
            mimeType
        )
        if (localFilePayload) {
            return localFilePayload
        }

        const remoteFilePayload = await tryFetchRemoteFile(
            plugin,
            source,
            fileName,
            mimeType,
            signal
        )
        if (remoteFilePayload) {
            return remoteFilePayload
        }

        return null
    }

    const buffer = convertToBuffer(source)

    if (!buffer) {
        return null
    }

    return {
        buffer,
        fileName: fileName ?? buildFallbackFileName(mimeType),
        mimeType
    }
}

export function tryParseDataUrl(
    source: string,
    preferredName?: string,
    preferredMime?: string
): FilePayload | null {
    const match = source.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) {
        return null
    }

    const mimeType = preferredMime ?? match[1]
    const buffer = Buffer.from(match[2], 'base64')
    const fileName = preferredName ?? buildFallbackFileName(mimeType)

    return {
        buffer,
        fileName,
        mimeType
    }
}

export async function tryReadLocalFile(
    source: string,
    preferredName?: string,
    preferredMime?: string
): Promise<FilePayload | null> {
    if (
        source.startsWith('http://') ||
        source.startsWith('https://') ||
        source.startsWith('data:')
    ) {
        return null
    }

    const filePath = source.startsWith('file://')
        ? fileURLToPath(source)
        : source

    if (!fs.existsSync(filePath)) {
        return null
    }

    try {
        const buffer = await readFile(filePath)
        const ext = path.extname(filePath)
        const mimeType = preferredMime ?? guessMimeType(ext)
        const rawName = path.basename(filePath)
        const fileName =
            preferredName ??
            (rawName.length > 0 ? rawName : buildFallbackFileName(mimeType))

        return {
            buffer,
            fileName,
            mimeType
        }
    } catch (error) {
        logger.warn(`Failed to read file from ${filePath}`, error)
        return null
    }
}

export async function tryFetchRemoteFile(
    plugin: ChatLunaPlugin,
    source: string,
    preferredName?: string,
    preferredMime?: string,
    signal?: AbortSignal
): Promise<FilePayload | null> {
    if (!source.startsWith('http://') && !source.startsWith('https://')) {
        return null
    }

    try {
        const response = await plugin.fetch(source, {
            method: 'GET',
            signal
        })

        if (!response.ok) {
            logger.warn(
                `Failed to fetch remote file: ${source}, status: ${response.status}`
            )
            return null
        }

        const buffer = Buffer.from(await response.arrayBuffer())
        const contentType = response.headers
            .get('content-type')
            ?.split(';')?.[0]

        let fileName: string

        try {
            const parsedUrl = new URL(source)
            const urlFileName = path.basename(parsedUrl.pathname)
            fileName =
                preferredName ??
                (urlFileName.length > 0
                    ? urlFileName
                    : buildFallbackFileName(contentType))
        } catch {
            fileName = preferredName ?? buildFallbackFileName(contentType)
        }

        return {
            buffer,
            fileName,
            mimeType: preferredMime ?? contentType
        }
    } catch (error) {
        logger.warn(`Failed to fetch remote file: ${source}`, error)
        return null
    }
}
