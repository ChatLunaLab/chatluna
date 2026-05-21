import { createHash } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { Context } from 'koishi'
import type {
    BindingRecord,
    ConversationRecord,
    MessageRecord
} from '../conversation_types'
import type {
    ArchiveManifest,
    ConversationArchivePayload,
    SerializedMessageRecord
} from '../services/types'
import { bufferToArrayBuffer, gzipDecode } from './compression'

export async function purgeArchivedConversation(
    ctx: Context,
    conversation: {
        id: string
        archiveId?: string | null
    }
) {
    await removeArchive(ctx, conversation.archiveId)

    await unbindConversation(ctx, conversation.id)
    await ctx.database.remove('chatluna_message', {
        conversationId: conversation.id
    })
    await ctx.database.remove('chatluna_acl', {
        conversationId: conversation.id
    })
    await ctx.database.remove('chatluna_conversation', {
        id: conversation.id
    })
}

export async function removeArchive(ctx: Context, archiveId?: string | null) {
    if (archiveId == null) {
        return
    }

    const archive = await ctx.chatluna.conversation.getArchive(archiveId)

    if (archive?.path) {
        await fs.rm(archive.path, {
            recursive: true,
            force: true
        })
    }

    await ctx.database.remove('chatluna_archive', {
        id: archiveId
    })
}

export async function unbindConversation(ctx: Context, conversationId: string) {
    const [active, last] = await Promise.all([
        ctx.database.get('chatluna_binding', {
            activeConversationId: conversationId
        }),
        ctx.database.get('chatluna_binding', {
            lastConversationId: conversationId
        })
    ])
    const bindings = Array.from(
        new Map(
            [...(active as BindingRecord[]), ...(last as BindingRecord[])].map(
                (item) => [item.bindingKey, item]
            )
        ).values()
    )

    for (const binding of bindings) {
        await ctx.database.upsert('chatluna_binding', [
            {
                bindingKey: binding.bindingKey,
                activeConversationId:
                    binding.activeConversationId === conversationId
                        ? null
                        : binding.activeConversationId,
                lastConversationId:
                    binding.lastConversationId === conversationId
                        ? null
                        : binding.lastConversationId,
                updatedAt: new Date()
            }
        ])
    }
}

export async function readArchivePayload(archivePath: string) {
    const stat = await fs.stat(archivePath)

    if (stat.isDirectory()) {
        const manifest = JSON.parse(
            await fs.readFile(path.join(archivePath, 'manifest.json'), 'utf8')
        ) as ArchiveManifest
        const conversation = JSON.parse(
            await fs.readFile(
                path.join(archivePath, 'conversation.json'),
                'utf8'
            )
        ) as ConversationArchivePayload['conversation']
        const messageBuffer = await fs.readFile(
            path.join(archivePath, 'messages.jsonl.gz')
        )

        if (manifest.size !== messageBuffer.byteLength) {
            throw new Error('Archive payload size mismatch.')
        }

        if (manifest.checksum != null && manifest.checksum.length > 0) {
            const checksum = createHash('sha256')
                .update(messageBuffer)
                .digest('hex')

            if (checksum !== manifest.checksum) {
                throw new Error('Archive payload checksum mismatch.')
            }
        }

        const messages = (await gzipDecode(messageBuffer))
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as SerializedMessageRecord)

        return {
            formatVersion: manifest.formatVersion,
            exportedAt: manifest.createdAt,
            conversation,
            messages
        }
    }

    return JSON.parse(
        await gzipDecode(await fs.readFile(archivePath))
    ) as ConversationArchivePayload
}

export function serializeConversation(
    conversation: ConversationRecord
): ConversationArchivePayload['conversation'] {
    return {
        ...conversation,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
        lastChatAt: conversation.lastChatAt
            ? conversation.lastChatAt.toISOString()
            : null,
        archivedAt: conversation.archivedAt
            ? conversation.archivedAt.toISOString()
            : null
    }
}

export function deserializeConversation(
    conversation: ConversationArchivePayload['conversation']
): ConversationRecord {
    return {
        ...conversation,
        createdAt: new Date(conversation.createdAt),
        updatedAt: new Date(conversation.updatedAt),
        lastChatAt: conversation.lastChatAt
            ? new Date(conversation.lastChatAt)
            : null,
        archivedAt: conversation.archivedAt
            ? new Date(conversation.archivedAt)
            : null
    }
}

export function serializeMessage(
    message: MessageRecord
): SerializedMessageRecord {
    return {
        ...message,
        content: serializeBinary(message.content),
        additional_kwargs_binary: serializeBinary(
            message.additional_kwargs_binary
        ),
        response_metadata_binary: serializeBinary(
            message.response_metadata_binary
        ),
        createdAt: message.createdAt?.toISOString() ?? null
    }
}

export function deserializeMessage(
    message: SerializedMessageRecord
): MessageRecord {
    return {
        ...message,
        content: deserializeBinary(message.content),
        additional_kwargs_binary: deserializeBinary(
            message.additional_kwargs_binary
        ),
        response_metadata_binary: deserializeBinary(
            message.response_metadata_binary
        ),
        createdAt: message.createdAt ? new Date(message.createdAt) : null
    }
}

function serializeBinary(value?: ArrayBuffer | null) {
    if (value == null) {
        return null
    }

    return Buffer.from(value).toString('base64')
}

function deserializeBinary(value?: string | null) {
    if (value == null || value.length === 0) {
        return null
    }

    return bufferToArrayBuffer(Buffer.from(value, 'base64'))
}
