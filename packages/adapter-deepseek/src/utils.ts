import { FileHandlingConfig } from 'koishi-plugin-chatluna/llm-core/platform/client'

// https://api-docs.deepseek.com/guides/vision
export const deepseekFileHandlingConfig: FileHandlingConfig = {
    supportedMimeTypes: new Set([
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp'
    ]),
    maxTotalSizeBytes: 48 * 1024 * 1024,
    maxFileSizeBytes: 32 * 1024 * 1024
}
