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

    const buffer = typeof blob === 'string' ? Buffer.from(blob, 'base64') : blob
    const extension = mimeTypes.extension(mimeType)

    if (!extension) {
        throw new Error(`Unsupported mime type: ${mimeType}`)
    }

    const fileName = `file.${extension}`
    return await ctx.chatluna_storage.createTempFile(buffer, fileName)
}
