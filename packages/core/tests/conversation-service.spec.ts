/// <reference types="mocha" />

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assert } from 'chai'
import type {
    ACLRecord,
    ArchiveRecord,
    BindingRecord,
    ConversationRecord,
    ConstraintRecord
} from '../src/services/conversation_types'
import { gzipEncode } from '../src/utils/compression'
import {
    createConversation,
    createMessage,
    createService,
    createSession,
    expectRejected,
    type TableRow
} from './helpers'

it('ConversationService resolves routed constraints and preset lanes', async () => {
    const highPriorityConstraint: ConstraintRecord = {
        id: 2,
        name: 'shared route',
        enabled: true,
        priority: 10,
        createdBy: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
        guildId: 'guild',
        routeMode: 'custom',
        routeKey: 'team-alpha',
        defaultModel: 'constraint/model',
        fixedPreset: 'fixed-preset',
        allowNew: false,
        allowSwitch: true,
        allowArchive: false,
        allowExport: true,
        manageMode: 'anyone'
    }
    const lowerPriorityConstraint: ConstraintRecord = {
        id: 1,
        name: 'fallback defaults',
        enabled: true,
        priority: 1,
        createdBy: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
        defaultPreset: 'constraint-default-preset',
        defaultChatMode: 'chat-mode-x',
        fixedModel: null,
        fixedChatMode: 'fixed-chat-mode'
    }

    const { service } = await createService({
        tables: {
            chatluna_constraint: [
                highPriorityConstraint as unknown as TableRow,
                lowerPriorityConstraint as unknown as TableRow
            ]
        }
    })

    const resolved = await service.resolveConstraint(createSession(), {
        presetLane: 'helper'
    })

    assert.equal(resolved.routeMode, 'custom')
    assert.equal(resolved.baseKey, 'custom:team-alpha')
    assert.equal(resolved.bindingKey, 'custom:team-alpha:preset:helper')
    assert.equal(resolved.defaultModel, 'constraint/model')
    assert.equal(resolved.defaultPreset, 'helper')
    assert.equal(resolved.fixedPreset, 'fixed-preset')
    assert.equal(resolved.fixedChatMode, 'fixed-chat-mode')
    assert.equal(resolved.allowNew, false)
    assert.equal(resolved.allowArchive, false)
    assert.equal(resolved.manageMode, 'anyone')
})

it('ConversationService gives fixed preset precedence over preset lane', async () => {
    const constraint: ConstraintRecord = {
        id: 1,
        name: 'fixed-preset',
        enabled: true,
        priority: 10,
        createdBy: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
        fixedPreset: 'fixed-preset'
    }

    const { service } = await createService({
        tables: {
            chatluna_constraint: [constraint as unknown as TableRow]
        }
    })

    const resolved = await service.resolveContext(createSession(), {
        presetLane: 'helper'
    })

    assert.equal(resolved.effectivePreset, 'fixed-preset')
})

it('ConversationService resolveContext uses explicit binding key constraints', async () => {
    const remote = createConversation({
        id: 'conversation-remote-binding',
        bindingKey: 'shared:discord:bot:other-guild'
    })
    const { service } = await createService({
        tables: {
            chatluna_conversation: [remote as unknown as TableRow],
            chatluna_constraint: [
                {
                    id: 1,
                    name: 'managed:discord:bot:guild:guild',
                    enabled: true,
                    priority: 1000,
                    createdBy: 'admin',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    platform: 'discord',
                    selfId: 'bot',
                    guildId: 'guild',
                    channelId: null,
                    direct: false,
                    users: null,
                    excludeUsers: null,
                    routeMode: null,
                    routeKey: null,
                    defaultModel: null,
                    defaultPreset: null,
                    defaultChatMode: null,
                    fixedModel: null,
                    fixedPreset: null,
                    fixedChatMode: null,
                    lockConversation: false,
                    allowNew: true,
                    allowSwitch: true,
                    allowArchive: true,
                    allowExport: true,
                    manageMode: 'admin'
                } as unknown as TableRow,
                {
                    id: 2,
                    name: 'managed:discord:bot:guild:other-guild',
                    enabled: true,
                    priority: 1000,
                    createdBy: 'admin',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    platform: 'discord',
                    selfId: 'bot',
                    guildId: 'other-guild',
                    channelId: null,
                    direct: false,
                    users: null,
                    excludeUsers: null,
                    routeMode: null,
                    routeKey: null,
                    defaultModel: null,
                    defaultPreset: null,
                    defaultChatMode: null,
                    fixedModel: null,
                    fixedPreset: null,
                    fixedChatMode: null,
                    lockConversation: true,
                    allowNew: true,
                    allowSwitch: true,
                    allowArchive: true,
                    allowExport: true,
                    manageMode: 'anyone'
                } as unknown as TableRow
            ]
        }
    })

    const resolved = await service.resolveContext(
        createSession({ authority: 1 }),
        {
            conversationId: remote.id,
            bindingKey: remote.bindingKey
        }
    )

    assert.equal(resolved.bindingKey, remote.bindingKey)
    assert.equal(resolved.conversation?.id, remote.id)
    assert.equal(resolved.constraint.manageMode, 'anyone')
    assert.equal(resolved.constraint.lockConversation, true)
})

it('ConversationService ensureActiveConversation creates conversation and binding on default route', async () => {
    const { service, database } = await createService()

    const resolved = await service.ensureActiveConversation(createSession())
    const binding = database.tables.chatluna_binding[0] as BindingRecord
    const conversation = database.tables.chatluna_conversation[0]

    assert.equal(resolved.bindingKey, 'shared:discord:bot:guild')
    assert.equal(binding.activeConversationId, resolved.conversation.id)
    assert.equal(conversation.id, resolved.conversation.id)
    assert.equal(conversation.seq, 1)
    assert.equal(conversation.legacyRoomId, null)
    assert.equal(conversation.legacyMeta, null)
    assert.equal(resolved.effectiveModel, 'test-platform/test-model')
    assert.equal(resolved.effectivePreset, 'default-preset')
    assert.equal(resolved.effectiveChatMode, 'plugin')
})

it('ConversationService restores archived current conversation automatically', async () => {
    const archivedConversation = createConversation({
        id: 'conversation-archived',
        status: 'archived',
        archiveId: 'archive-1',
        archivedAt: new Date('2026-03-22T00:00:00.000Z'),
        latestMessageId: null
    })
    const archivedPayload = {
        formatVersion: 1,
        exportedAt: '2026-03-22T00:00:00.000Z',
        conversation: {
            ...archivedConversation,
            status: 'active',
            archiveId: null,
            archivedAt: null,
            createdAt: archivedConversation.createdAt.toISOString(),
            updatedAt: archivedConversation.updatedAt.toISOString(),
            lastChatAt: archivedConversation.lastChatAt?.toISOString() ?? null
        },
        messages: []
    }
    const archiveDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chatluna-restore-test-')
    )
    const archivePath = path.join(archiveDir, 'archive.json.gz')
    await fs.writeFile(
        archivePath,
        await gzipEncode(JSON.stringify(archivedPayload))
    )

    const { service } = await createService({
        baseDir: archiveDir,
        tables: {
            chatluna_conversation: [
                archivedConversation as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: 'shared:discord:bot:guild',
                    activeConversationId: 'conversation-archived',
                    lastConversationId: null,
                    updatedAt: new Date()
                }
            ],
            chatluna_archive: [
                {
                    id: 'archive-1',
                    conversationId: 'conversation-archived',
                    path: archivePath,
                    formatVersion: 1,
                    messageCount: 0,
                    checksum: null,
                    size: 1,
                    state: 'ready',
                    createdAt: new Date(),
                    restoredAt: null
                }
            ]
        }
    })

    const resolved = await service.ensureActiveConversation(createSession())

    assert.equal(resolved.conversation.id, 'conversation-archived')
    assert.equal(resolved.conversation.status, 'active')
    assert.equal(resolved.conversation.archiveId, null)
})

it('ConversationService does not auto-restore archived conversation without manage permission', async () => {
    const archivedConversation = createConversation({
        id: 'conversation-archived-locked',
        status: 'archived',
        archiveId: 'archive-locked',
        archivedAt: new Date('2026-03-22T00:00:00.000Z'),
        latestMessageId: null
    })
    const archiveDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chatluna-restore-blocked-test-')
    )
    const archivePath = path.join(archiveDir, 'archive.json.gz')
    await fs.writeFile(
        archivePath,
        await gzipEncode(
            JSON.stringify({
                formatVersion: 1,
                exportedAt: '2026-03-22T00:00:00.000Z',
                conversation: {
                    ...archivedConversation,
                    status: 'active',
                    archiveId: null,
                    archivedAt: null,
                    createdAt: archivedConversation.createdAt.toISOString(),
                    updatedAt: archivedConversation.updatedAt.toISOString(),
                    lastChatAt:
                        archivedConversation.lastChatAt?.toISOString() ?? null
                },
                messages: []
            })
        )
    )

    const { service } = await createService({
        baseDir: archiveDir,
        tables: {
            chatluna_conversation: [
                archivedConversation as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: 'shared:discord:bot:guild',
                    activeConversationId: archivedConversation.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                }
            ],
            chatluna_archive: [
                {
                    id: 'archive-locked',
                    conversationId: archivedConversation.id,
                    path: archivePath,
                    formatVersion: 1,
                    messageCount: 0,
                    checksum: null,
                    size: 1,
                    state: 'ready',
                    createdAt: new Date(),
                    restoredAt: null
                }
            ]
        }
    })

    await expectRejected(
        service.ensureActiveConversation(createSession({ authority: 1 })),
        /administrator permission/
    )
})

it('ConversationService clears archive data when deleting archived conversation', async () => {
    const dir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chatluna-delete-archive-test-')
    )
    const archiveDir = path.join(dir, 'archive-dir')
    await fs.mkdir(archiveDir, { recursive: true })
    await fs.writeFile(path.join(archiveDir, 'manifest.json'), '{}', 'utf8')

    const conversation = createConversation({
        id: 'conversation-delete-archived',
        status: 'archived',
        archiveId: 'archive-delete',
        archivedAt: new Date('2026-03-22T00:00:00.000Z')
    })

    const { service, database } = await createService({
        baseDir: dir,
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
            chatluna_archive: [
                {
                    id: 'archive-delete',
                    conversationId: conversation.id,
                    path: archiveDir,
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

    const deleted = await service.deleteConversation(createSession(), {
        conversationId: conversation.id
    })
    const stored = database.tables
        .chatluna_conversation[0] as ConversationRecord
    const binding = database.tables.chatluna_binding[0] as BindingRecord

    assert.equal(deleted.status, 'deleted')
    assert.equal(deleted.archiveId, null)
    assert.equal(stored.archiveId, null)
    assert.equal(database.tables.chatluna_archive.length, 0)
    assert.equal(binding.activeConversationId, null)
    await expectRejected(fs.access(archiveDir))
})

it('ConversationService ensureActiveConversation respects personal default group route mode', async () => {
    const { service } = await createService({
        config: {
            defaultGroupRouteMode: 'personal'
        }
    })

    const resolved = await service.ensureActiveConversation(createSession())

    assert.equal(resolved.bindingKey, 'personal:discord:bot:guild:user')
    assert.equal(resolved.conversation.seq, 1)
})

it('ConversationService switches and resolves friendly conversation targets within the same binding', async () => {
    const older = createConversation({
        id: 'conversation-old',
        seq: 1,
        title: 'Older',
        lastChatAt: new Date('2026-03-20T00:00:00.000Z')
    })
    const newer = createConversation({
        id: 'conversation-new',
        seq: 2,
        title: 'Newer Topic',
        lastChatAt: new Date('2026-03-22T00:00:00.000Z')
    })

    const { service, database } = await createService({
        tables: {
            chatluna_conversation: [
                older as unknown as TableRow,
                newer as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: 'shared:discord:bot:guild',
                    activeConversationId: 'conversation-old',
                    lastConversationId: null,
                    updatedAt: new Date()
                }
            ]
        }
    })

    const listed = await service.listConversations(createSession())
    assert.deepEqual(
        listed.map((item) => item.id),
        ['conversation-new', 'conversation-old']
    )

    const bySeq = await service.switchConversation(createSession(), {
        targetConversation: '2'
    })
    const byId = await service.switchConversation(createSession(), {
        targetConversation: 'conversation-old'
    })
    const byTitle = await service.switchConversation(createSession(), {
        targetConversation: 'newer topic'
    })
    const byPartialTitle = await service.switchConversation(createSession(), {
        targetConversation: 'Topic'
    })
    const binding = database.tables.chatluna_binding[0] as BindingRecord

    assert.equal(bySeq.id, 'conversation-new')
    assert.equal(byId.id, 'conversation-old')
    assert.equal(byTitle.id, 'conversation-new')
    assert.equal(byPartialTitle.id, 'conversation-new')
    assert.equal(binding.activeConversationId, 'conversation-new')
    assert.equal(binding.lastConversationId, 'conversation-old')
})

it('ConversationService lists and switches preset lanes across canonical and legacy routes', async () => {
    const session = createSession({
        platform: 'onebot',
        selfId: '1016049163',
        guildId: '391122026',
        channelId: '391122026'
    })
    const canonicalBase = 'shared:onebot:1016049163:391122026'
    const legacyBase = 'shared:legacy:legacy:391122026'
    const legacy = createConversation({
        id: 'conversation-legacy',
        bindingKey: legacyBase,
        title: 'Legacy',
        seq: 1,
        lastChatAt: new Date('2026-03-21T00:00:00.000Z')
    })
    const aqua = createConversation({
        id: 'conversation-aqua',
        bindingKey: `${canonicalBase}:preset:Aqua`,
        title: 'Aqua',
        seq: 1,
        lastChatAt: new Date('2026-03-22T00:00:00.000Z')
    })
    const chatgpt = createConversation({
        id: 'conversation-chatgpt',
        bindingKey: `${canonicalBase}:preset:chatgpt`,
        title: 'ChatGPT',
        seq: 1,
        lastChatAt: new Date('2026-03-23T00:00:00.000Z')
    })
    const sydney = createConversation({
        id: 'conversation-sydney',
        bindingKey: `${canonicalBase}:preset:sydney`,
        title: 'Sydney',
        seq: 1,
        lastChatAt: new Date('2026-03-24T00:00:00.000Z')
    })

    const { service, database } = await createService({
        tables: {
            chatluna_conversation: [
                legacy as unknown as TableRow,
                aqua as unknown as TableRow,
                chatgpt as unknown as TableRow,
                sydney as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: legacyBase,
                    activeConversationId: legacy.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                }
            ]
        }
    })

    const listed = await service.listConversations(session, {
        allPresetLanes: true
    })
    const entries = await service.listConversationEntries(session, {
        allPresetLanes: true
    })
    const switched = await service.switchConversation(session, {
        targetConversation: '2',
        allPresetLanes: true
    })
    const managed = await service.getManagedConstraint(session)
    const legacyBinding = database.tables.chatluna_binding.find(
        (item) => item.bindingKey === legacyBase
    ) as BindingRecord | undefined
    const laneBinding = database.tables.chatluna_binding.find(
        (item) => item.bindingKey === chatgpt.bindingKey
    ) as BindingRecord | undefined

    assert.deepEqual(
        listed.map((item) => item.id),
        [
            'conversation-sydney',
            'conversation-chatgpt',
            'conversation-aqua',
            'conversation-legacy'
        ]
    )
    assert.deepEqual(
        entries.map((item) => [item.displaySeq, item.conversation.id]),
        [
            [1, 'conversation-sydney'],
            [2, 'conversation-chatgpt'],
            [3, 'conversation-aqua'],
            [4, 'conversation-legacy']
        ]
    )
    assert.equal(switched.id, 'conversation-chatgpt')
    assert.equal(legacyBinding?.activeConversationId, 'conversation-legacy')
    assert.equal(laneBinding?.activeConversationId, 'conversation-chatgpt')
    assert.equal(managed?.activePresetLane, 'chatgpt')
})

it('ConversationService allows exact id across preset lanes when allPresetLanes is enabled', async () => {
    const laneA = createConversation({
        id: 'conversation-lane-a',
        bindingKey: 'shared:discord:bot:guild:preset:A'
    })
    const laneB = createConversation({
        id: 'conversation-lane-b',
        bindingKey: 'shared:discord:bot:guild:preset:B'
    })

    const { service } = await createService({
        tables: {
            chatluna_conversation: [
                laneA as unknown as TableRow,
                laneB as unknown as TableRow
            ]
        }
    })

    const resolved = await service.resolveCommandConversation(createSession(), {
        conversationId: laneB.id,
        allPresetLanes: true,
        permission: 'manage'
    })

    assert.equal(resolved?.id, laneB.id)
})

it('ConversationService allows exact id across legacy and canonical route family', async () => {
    const session = createSession({
        platform: 'onebot',
        selfId: '1016049163',
        guildId: '391122026',
        channelId: '391122026'
    })
    const legacy = createConversation({
        id: 'conversation-legacy-route',
        bindingKey: 'shared:legacy:legacy:391122026'
    })
    const canonical = createConversation({
        id: 'conversation-canonical-route',
        bindingKey: 'shared:onebot:1016049163:391122026:preset:chatgpt'
    })

    const { service } = await createService({
        tables: {
            chatluna_conversation: [
                legacy as unknown as TableRow,
                canonical as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: legacy.bindingKey,
                    activeConversationId: legacy.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                } as unknown as TableRow
            ]
        }
    })

    const resolved = await service.resolveCommandConversation(session, {
        conversationId: canonical.id,
        allPresetLanes: true,
        permission: 'manage'
    })

    assert.equal(resolved?.id, canonical.id)
})

it('ConversationService keeps current lane binding untouched when switching across preset lanes', async () => {
    const laneA = createConversation({
        id: 'conversation-switch-lane-a',
        bindingKey: 'shared:discord:bot:guild:preset:A'
    })
    const laneB = createConversation({
        id: 'conversation-switch-lane-b',
        bindingKey: 'shared:discord:bot:guild:preset:B'
    })

    const { service, database } = await createService({
        tables: {
            chatluna_conversation: [
                laneA as unknown as TableRow,
                laneB as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: laneA.bindingKey,
                    activeConversationId: laneA.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                } as unknown as TableRow
            ]
        }
    })

    await service.switchConversation(createSession(), {
        targetConversation: laneB.id,
        allPresetLanes: true
    })

    const bindingA = database.tables.chatluna_binding.find(
        (item) => item.bindingKey === laneA.bindingKey
    ) as BindingRecord | undefined
    const bindingB = database.tables.chatluna_binding.find(
        (item) => item.bindingKey === laneB.bindingKey
    ) as BindingRecord | undefined

    assert.equal(bindingA?.activeConversationId, laneA.id)
    assert.equal(bindingB?.activeConversationId, laneB.id)
})

it('ConversationService syncs managed preset lane when reopening archived route-family conversation', async () => {
    const dir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'chatluna-reopen-lane-')
    )
    const archivePath = path.join(dir, 'archive.json.gz')
    const session = createSession({
        platform: 'onebot',
        selfId: '1016049163',
        guildId: '391122026',
        channelId: '391122026'
    })
    const legacy = createConversation({
        id: 'conversation-legacy-reopen',
        bindingKey: 'shared:legacy:legacy:391122026'
    })
    const archived = createConversation({
        id: 'conversation-archived-lane',
        bindingKey: 'shared:onebot:1016049163:391122026:preset:chatgpt',
        status: 'archived',
        archiveId: 'archive-lane',
        archivedAt: new Date('2026-03-25T00:00:00.000Z'),
        latestMessageId: null
    })
    await fs.writeFile(
        archivePath,
        await gzipEncode(
            JSON.stringify({
                formatVersion: 1,
                exportedAt: '2026-03-25T00:00:00.000Z',
                conversation: {
                    ...archived,
                    status: 'active',
                    archiveId: null,
                    archivedAt: null,
                    createdAt: archived.createdAt.toISOString(),
                    updatedAt: archived.updatedAt.toISOString(),
                    lastChatAt: archived.lastChatAt?.toISOString() ?? null
                },
                messages: []
            })
        )
    )

    const { service } = await createService({
        baseDir: dir,
        tables: {
            chatluna_conversation: [
                legacy as unknown as TableRow,
                archived as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: legacy.bindingKey,
                    activeConversationId: legacy.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                } as unknown as TableRow
            ],
            chatluna_archive: [
                {
                    id: 'archive-lane',
                    conversationId: archived.id,
                    path: archivePath,
                    formatVersion: 1,
                    messageCount: 0,
                    checksum: null,
                    size: (await fs.stat(archivePath)).size,
                    state: 'ready',
                    createdAt: new Date('2026-03-25T00:00:00.000Z'),
                    restoredAt: null
                } as unknown as TableRow
            ]
        }
    })

    const reopened = await service.reopenConversation(session, {
        conversationId: archived.id,
        allPresetLanes: true
    })
    const managed = await service.getManagedConstraint(session)

    assert.equal(reopened.status, 'active')
    assert.equal(managed?.activePresetLane, 'chatgpt')
})

it('ConversationService rejects ambiguous friendly conversation targets', async () => {
    const alpha = createConversation({
        id: 'conversation-alpha',
        seq: 1,
        title: 'Project Alpha'
    })
    const beta = createConversation({
        id: 'conversation-beta',
        seq: 2,
        title: 'Project Beta'
    })

    const { service } = await createService({
        tables: {
            chatluna_conversation: [
                alpha as unknown as TableRow,
                beta as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: 'shared:discord:bot:guild',
                    activeConversationId: 'conversation-alpha',
                    lastConversationId: null,
                    updatedAt: new Date()
                }
            ]
        }
    })

    await expectRejected(
        service.switchConversation(createSession(), {
            targetConversation: 'Project'
        }),
        /Conversation target is ambiguous\./
    )
})

it('ConversationService records compression metadata and use rejects fixed fields', async () => {
    const conversation = createConversation()
    const message = createMessage({
        id: 'summary',
        conversationId: conversation.id,
        text: 'compressed summary',
        name: 'infinite_context'
    })
    const { service } = await createService({
        tables: {
            chatluna_conversation: [conversation as unknown as TableRow],
            chatluna_binding: [
                {
                    bindingKey: conversation.bindingKey,
                    activeConversationId: conversation.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                }
            ],
            chatluna_message: [message as unknown as TableRow],
            chatluna_constraint: [
                {
                    id: 1,
                    name: 'managed:discord:bot:guild:guild',
                    enabled: true,
                    priority: 1000,
                    createdBy: 'admin',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    platform: 'discord',
                    selfId: 'bot',
                    guildId: 'guild',
                    channelId: null,
                    direct: false,
                    users: null,
                    excludeUsers: null,
                    routeMode: null,
                    routeKey: null,
                    defaultModel: null,
                    defaultPreset: null,
                    defaultChatMode: null,
                    fixedModel: 'fixed-model',
                    fixedPreset: null,
                    fixedChatMode: null,
                    lockConversation: false,
                    allowNew: true,
                    allowSwitch: true,
                    allowArchive: true,
                    allowExport: true,
                    manageMode: 'anyone'
                } as unknown as TableRow
            ]
        }
    })

    const updated = await service.recordCompression(conversation.id, {
        compressed: true,
        inputTokens: 120,
        outputTokens: 30,
        reducedTokens: 90,
        reducedPercent: 75,
        originalMessageCount: 8,
        remainingMessageCount: 1
    })
    const compression = JSON.parse(updated.compression ?? '{}')

    assert.equal(compression.count, 1)
    assert.equal(compression.summary, 'compressed summary')
    assert.equal(compression.outputTokens, 30)
    assert.equal(compression.originalMessageCount, 8)
    assert.equal(compression.remainingMessageCount, 1)

    await expectRejected(
        service.updateConversationUsage(createSession(), {
            model: 'other-model'
        }),
        /fixed to fixed-model/
    )
})

it('ConversationService blocks raw id access outside route without ACL and allows manage ACL', async () => {
    const local = createConversation({
        id: 'conversation-local',
        bindingKey: 'shared:discord:bot:guild'
    })
    const remote = createConversation({
        id: 'conversation-remote',
        bindingKey: 'shared:discord:bot:other-guild'
    })
    const acl: ACLRecord = {
        conversationId: remote.id,
        principalType: 'user',
        principalId: 'user',
        permission: 'manage'
    }

    const { service, database } = await createService({
        tables: {
            chatluna_conversation: [
                local as unknown as TableRow,
                remote as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: local.bindingKey,
                    activeConversationId: local.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                }
            ]
        }
    })

    await expectRejected(
        service.resolveCommandConversation(createSession({ authority: 1 }), {
            conversationId: remote.id,
            permission: 'manage'
        }),
        /does not belong to current route/
    )

    database.tables.chatluna_acl.push(acl as unknown as TableRow)

    const resolved = await service.resolveCommandConversation(
        createSession({ authority: 1 }),
        {
            conversationId: remote.id,
            permission: 'manage'
        }
    )

    assert.equal(resolved.id, remote.id)
})

it('ConversationService resolves ACL-backed cross-route targetConversation', async () => {
    const local = createConversation({
        id: 'conversation-local-2',
        bindingKey: 'shared:discord:bot:guild'
    })
    const remote = createConversation({
        id: 'conversation-remote-2',
        bindingKey: 'shared:discord:bot:other-guild',
        title: 'Remote Shared Topic',
        seq: 7
    })

    const { service } = await createService({
        tables: {
            chatluna_conversation: [
                local as unknown as TableRow,
                remote as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: local.bindingKey,
                    activeConversationId: local.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                }
            ],
            chatluna_acl: [
                {
                    conversationId: remote.id,
                    principalType: 'user',
                    principalId: 'user',
                    permission: 'manage'
                } as unknown as TableRow
            ]
        }
    })

    const byId = await service.resolveCommandConversation(
        createSession({ authority: 1 }),
        {
            targetConversation: remote.id,
            permission: 'manage'
        }
    )
    const byTitle = await service.resolveCommandConversation(
        createSession({ authority: 1 }),
        {
            targetConversation: 'Remote Shared Topic',
            permission: 'manage'
        }
    )

    assert.equal(byId?.id, remote.id)
    assert.equal(byTitle?.id, remote.id)
})

it('ConversationService rejects ambiguous global exact title matches', async () => {
    const local = createConversation({
        id: 'conversation-local-title',
        bindingKey: 'shared:discord:bot:guild'
    })
    const remoteA = createConversation({
        id: 'conversation-remote-title-a',
        bindingKey: 'shared:discord:bot:other-guild-a',
        title: 'Shared Topic'
    })
    const remoteB = createConversation({
        id: 'conversation-remote-title-b',
        bindingKey: 'shared:discord:bot:other-guild-b',
        title: 'Shared Topic'
    })

    const { service } = await createService({
        tables: {
            chatluna_conversation: [
                local as unknown as TableRow,
                remoteA as unknown as TableRow,
                remoteB as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: local.bindingKey,
                    activeConversationId: local.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                } as unknown as TableRow
            ],
            chatluna_acl: [
                {
                    conversationId: remoteA.id,
                    principalType: 'user',
                    principalId: 'user',
                    permission: 'manage'
                } as unknown as TableRow,
                {
                    conversationId: remoteB.id,
                    principalType: 'user',
                    principalId: 'user',
                    permission: 'manage'
                } as unknown as TableRow
            ]
        }
    })

    await expectRejected(
        service.resolveCommandConversation(createSession({ authority: 1 }), {
            targetConversation: 'Shared Topic',
            permission: 'manage'
        }),
        /Conversation target is ambiguous\./
    )
})

it('ConversationService keeps local bindings untouched for cross-route switch and reopen', async () => {
    const local = createConversation({
        id: 'conversation-local-switch',
        bindingKey: 'shared:discord:bot:guild'
    })
    const remote = createConversation({
        id: 'conversation-remote-switch',
        bindingKey: 'shared:discord:bot:other-guild',
        title: 'Remote Topic'
    })

    const { service, database } = await createService({
        tables: {
            chatluna_conversation: [
                local as unknown as TableRow,
                remote as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: local.bindingKey,
                    activeConversationId: local.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                } as unknown as TableRow
            ]
        }
    })

    await service.switchConversation(createSession(), {
        targetConversation: remote.id
    })
    await service.reopenConversation(createSession(), {
        conversationId: remote.id
    })

    const localBinding = database.tables.chatluna_binding.find(
        (item) => item.bindingKey === local.bindingKey
    ) as BindingRecord | undefined
    const remoteBinding = database.tables.chatluna_binding.find(
        (item) => item.bindingKey === remote.bindingKey
    ) as BindingRecord | undefined

    assert.equal(localBinding?.activeConversationId, local.id)
    assert.equal(remoteBinding?.activeConversationId, remote.id)
})

it('ConversationService upserts and removes ACL records coherently', async () => {
    const conversation = createConversation({ id: 'conversation-acl' })
    const { service } = await createService({
        tables: {
            chatluna_conversation: [conversation as unknown as TableRow]
        }
    })

    const created = await service.upsertAcl(conversation.id, [
        {
            principalType: 'user',
            principalId: 'alice',
            permission: 'view'
        },
        {
            principalType: 'guild',
            principalId: 'guild-x',
            permission: 'manage'
        }
    ])

    assert.equal(created.length, 2)

    const afterRemove = await service.removeAcl(conversation.id, [
        {
            principalType: 'user',
            principalId: 'alice'
        }
    ])

    assert.deepEqual(afterRemove, [
        {
            conversationId: conversation.id,
            principalType: 'guild',
            principalId: 'guild-x',
            permission: 'manage'
        }
    ])
})

it('ConversationService emits conversation lifecycle events for switch archive restore delete and compression', async () => {
    const active = createConversation({ id: 'conversation-active', seq: 1 })
    const next = createConversation({
        id: 'conversation-next',
        seq: 2,
        title: 'Next Topic'
    })
    const { service, events, syncCalls } = await createService({
        tables: {
            chatluna_conversation: [
                active as unknown as TableRow,
                next as unknown as TableRow
            ],
            chatluna_binding: [
                {
                    bindingKey: active.bindingKey,
                    activeConversationId: active.id,
                    lastConversationId: null,
                    updatedAt: new Date()
                }
            ],
            chatluna_message: [
                createMessage({
                    id: 'summary-message',
                    conversationId: next.id,
                    name: 'infinite_context',
                    text: 'summary'
                }) as unknown as TableRow
            ]
        }
    })

    await service.switchConversation(createSession(), {
        targetConversation: next.id
    })
    await service.recordCompression(next.id, {
        compressed: true,
        inputTokens: 100,
        outputTokens: 20,
        reducedTokens: 80,
        reducedPercent: 80,
        originalMessageCount: 10,
        remainingMessageCount: 2
    })

    const archived = await service.archiveConversation(createSession(), {
        conversationId: next.id
    })
    await service.restoreConversation(createSession(), {
        conversationId: next.id,
        archiveId: archived.archive.id
    })
    await service.deleteConversation(createSession(), {
        conversationId: next.id
    })

    assert.deepEqual(
        events.map((item) => item.name),
        [
            'chatluna/conversation-before-switch',
            'chatluna/conversation-after-switch',
            'chatluna/conversation-compressed',
            'chatluna/conversation-before-archive',
            'chatluna/conversation-after-archive',
            'chatluna/conversation-before-restore',
            'chatluna/conversation-after-restore',
            'chatluna/conversation-before-delete',
            'chatluna/conversation-after-delete'
        ]
    )
    assert.deepEqual(syncCalls, [next.id, next.id, next.id])
})
