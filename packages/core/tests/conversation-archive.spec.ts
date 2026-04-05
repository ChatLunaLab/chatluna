/// <reference types="mocha" />

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assert } from 'chai'
import { purgeArchivedConversation } from '../src/utils/archive'
import { gzipEncode } from '../src/utils/compression'
import type {
    ArchiveRecord,
    BindingRecord,
    ConversationRecord
} from '../src/services/conversation_types'
import {
    createConversation,
    createMessage,
    createService,
    createSession,
    expectRejected,
    type TableRow
} from './helpers'

it('ConversationService exports, archives, and restores conversations with legacy migration fields', async () => {
    const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chatluna-archive-test-')
    )
    const exportPath = path.join(tempDir, 'conversation-export.md')

    const conversation = createConversation({
        id: 'conversation-archive',
        title: 'Archived Conversation',
        latestMessageId: 'message-2',
        legacyRoomId: 42,
        legacyMeta: JSON.stringify({ roomName: 'legacy-room' })
    })
    const messageA = createMessage({
        id: 'message-1',
        conversationId: 'conversation-archive',
        text: 'hello'
    })
    const messageB = createMessage({
        id: 'message-2',
        conversationId: 'conversation-archive',
        parentId: 'message-1',
        role: 'ai',
        text: 'world'
    })

    const { service, database, clearCacheCalls } = await createService({
        baseDir: tempDir,
        tables: {
            chatluna_conversation: [conversation as unknown as TableRow],
            chatluna_binding: [
                {
                    bindingKey: 'shared:discord:bot:guild',
                    activeConversationId: 'conversation-archive',
                    lastConversationId: null,
                    updatedAt: new Date()
                }
            ],
            chatluna_message: [
                messageA as unknown as TableRow,
                messageB as unknown as TableRow
            ]
        }
    })

    const exported = await service.exportConversation(createSession(), {
        conversationId: 'conversation-archive',
        outputPath: exportPath
    })
    const exportMarkdown = await fs.readFile(exported.path, 'utf8')

    assert.match(exportMarkdown, /# Archived Conversation/)
    assert.match(exportMarkdown, /hello/)
    assert.match(exportMarkdown, /world/)

    const archived = await service.archiveConversation(createSession(), {
        conversationId: 'conversation-archive'
    })
    const archivedConversation = await service.getConversation(
        'conversation-archive'
    )
    const archiveRecord = archived.archive as ArchiveRecord
    const manifest = JSON.parse(
        await fs.readFile(path.join(archived.path, 'manifest.json'), 'utf8')
    )

    assert.equal(archivedConversation.status, 'archived')
    assert.equal(archivedConversation.archiveId, archiveRecord.id)
    assert.equal(manifest.conversationId, 'conversation-archive')
    assert.equal(database.tables.chatluna_message.length, 0)
    assert.deepEqual(clearCacheCalls, ['conversation-archive'])

    const restored = await service.restoreConversation(createSession(), {
        conversationId: 'conversation-archive'
    })
    const restoredMessages = await service.listMessages('conversation-archive')
    const restoredArchive = await service.getArchive(archiveRecord.id)

    assert.equal(restored.status, 'active')
    assert.equal(restored.archiveId, null)
    assert.equal(restored.legacyRoomId, 42)
    assert.equal(
        restored.legacyMeta,
        JSON.stringify({ roomName: 'legacy-room' })
    )
    assert.equal(restoredMessages.length, 2)
    assert.equal(restoredArchive.state, 'ready')
    assert.notEqual(restoredArchive.restoredAt, null)
})

it('ConversationService rejects restoring archives from another conversation', async () => {
    const conversation = createConversation({
        id: 'conversation-restore-owner'
    })
    const foreignArchive: ArchiveRecord = {
        id: 'archive-foreign',
        conversationId: 'conversation-foreign',
        path: path.join(os.tmpdir(), 'archive-foreign'),
        formatVersion: 1,
        messageCount: 0,
        checksum: null,
        size: 0,
        state: 'ready',
        createdAt: new Date(),
        restoredAt: null
    }

    const { service } = await createService({
        tables: {
            chatluna_conversation: [conversation as unknown as TableRow],
            chatluna_binding: [
                {
                    bindingKey: conversation.bindingKey,
                    activeConversationId: conversation.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                } as unknown as TableRow
            ],
            chatluna_archive: [foreignArchive as unknown as TableRow]
        }
    })

    await expectRejected(
        service.restoreConversation(createSession(), {
            conversationId: conversation.id,
            archiveId: foreignArchive.id
        }),
        /Archive does not belong to conversation\./
    )
})

it('ConversationService rejects restoring a foreign conversation by exact id', async () => {
    const dir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chatluna-foreign-restore-')
    )
    const conversation = createConversation({
        id: 'conversation-foreign-restore',
        bindingKey: 'shared:discord:bot:other-guild',
        status: 'archived',
        archiveId: 'archive-foreign-restore',
        archivedAt: new Date('2026-03-22T00:00:00.000Z')
    })
    const archivePath = path.join(dir, 'archive-foreign-restore.json.gz')

    await fs.writeFile(
        archivePath,
        await gzipEncode(
            JSON.stringify({
                formatVersion: 1,
                exportedAt: '2026-03-22T00:00:00.000Z',
                conversation: {
                    ...conversation,
                    status: 'active',
                    archiveId: null,
                    archivedAt: null,
                    createdAt: conversation.createdAt.toISOString(),
                    updatedAt: conversation.updatedAt.toISOString(),
                    lastChatAt: conversation.lastChatAt?.toISOString() ?? null
                },
                messages: []
            })
        )
    )

    const { service } = await createService({
        baseDir: dir,
        tables: {
            chatluna_conversation: [conversation as unknown as TableRow],
            chatluna_constraint: [
                {
                    id: 1,
                    name: 'allow-manage-current-route',
                    enabled: true,
                    priority: 10,
                    createdBy: 'admin',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    guildId: 'guild',
                    manageMode: 'anyone'
                } as unknown as TableRow
            ],
            chatluna_archive: [
                {
                    id: conversation.archiveId,
                    conversationId: conversation.id,
                    path: archivePath,
                    formatVersion: 1,
                    messageCount: 0,
                    checksum: null,
                    size: 1,
                    state: 'ready',
                    createdAt: new Date(),
                    restoredAt: null
                } as unknown as TableRow
            ]
        }
    })

    await expectRejected(
        service.restoreConversation(createSession({ authority: 1 }), {
            conversationId: conversation.id
        }),
        /Conversation does not belong to current route\./
    )
})

it('purgeArchivedConversation removes archive directory and clears both binding pointers', async () => {
    const dir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chatluna-purge-archive-')
    )
    const archiveDir = path.join(dir, 'archive-dir')
    await fs.mkdir(archiveDir, { recursive: true })
    await fs.writeFile(path.join(archiveDir, 'manifest.json'), '{}', 'utf8')

    const conversation = createConversation({
        id: 'conversation-purge',
        status: 'archived',
        archiveId: 'archive-purge'
    })
    const { ctx, database } = await createService({
        baseDir: dir,
        tables: {
            chatluna_conversation: [conversation as unknown as TableRow],
            chatluna_binding: [
                {
                    bindingKey: conversation.bindingKey,
                    activeConversationId: conversation.id,
                    lastConversationId: conversation.id,
                    updatedAt: new Date()
                }
            ],
            chatluna_archive: [
                {
                    id: 'archive-purge',
                    conversationId: conversation.id,
                    path: archiveDir,
                    formatVersion: 1,
                    messageCount: 1,
                    checksum: null,
                    size: 1,
                    state: 'ready',
                    createdAt: new Date(),
                    restoredAt: null
                }
            ],
            chatluna_message: [
                createMessage({
                    conversationId: conversation.id
                }) as unknown as TableRow
            ],
            chatluna_acl: [
                {
                    conversationId: conversation.id,
                    principalType: 'user',
                    principalId: 'user',
                    permission: 'view'
                } as unknown as TableRow
            ]
        }
    })

    await purgeArchivedConversation(ctx, conversation)

    await expectRejected(fs.access(archiveDir))
    assert.equal(database.tables.chatluna_conversation.length, 0)
    assert.equal(database.tables.chatluna_archive.length, 0)
    assert.equal(database.tables.chatluna_message.length, 0)
    assert.equal(database.tables.chatluna_acl.length, 0)
    assert.equal(database.tables.chatluna_binding[0].activeConversationId, null)
    assert.equal(database.tables.chatluna_binding[0].lastConversationId, null)
})
