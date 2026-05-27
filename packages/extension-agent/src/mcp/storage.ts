/** @module mcp/storage */

import { Context } from 'koishi'
import type {} from 'koishi-plugin-chatluna-storage-service'
import mimeTypes from 'mime-types'

export async function putResourceToChatLunaStorage(
    ctx: Context,
    blob: string | Buffer,
    mimeType: string
): Promise<Awaited<ReturnType<typeof ctx.chatluna_storage.createTempFile>>> {
    if (!ctx.chatluna_storage) {
        return
    }

    const ext = mimeTypes.extension(mimeType)

    if (!ext) {
        throw new Error(`Unsupported mime type: ${mimeType}`)
    }

    return await ctx.chatluna_storage.createTempFile(
        typeof blob === 'string' ? Buffer.from(blob, 'base64') : blob,
        `file.${ext}`
    )
}
