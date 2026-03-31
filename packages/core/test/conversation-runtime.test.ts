import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { HumanMessage } from '@langchain/core/messages'
import { Pagination } from '../src/utils/pagination'
import {
    bufferToArrayBuffer,
    gzipDecode,
    gzipEncode
} from '../src/utils/compression'
import {
    getMessageContent,
    parsePresetLaneInput
} from '../src/utils/message_content'
import {
    type ACLRecord,
    applyPresetLane,
    type ArchiveRecord,
    type BindingRecord,
    computeBaseBindingKey,
    type ConstraintRecord,
    type ConversationRecord,
    type MessageRecord
} from '../src/services/conversation_types'
import { ConversationService } from '../src/services/conversation'
import { ConversationRuntime } from '../src/services/conversation_runtime'
import {
    createLegacyBindingKey,
    inferLegacyGroupRouteModes
} from '../src/migration/validators'
import {
    getLegacySchemaSentinel,
    getLegacySchemaSentinelDir
} from '../src/migration/legacy_tables'
import { runRoomToConversationMigration } from '../src/migration/room_to_conversation'
import { purgeArchivedConversation } from '../src/utils/archive'

type BindingSessionShape = {
    platform?: string
    selfId?: string
    guildId?: string
    userId?: string
    channelId?: string
    sid?: string
    isDirect?: boolean
    authority?: number
}

type TableRow = Record<string, unknown>
type Tables = Record<string, TableRow[]>

class FakeDatabase {
    tables: Tables = {
        chatluna_meta: [],
        chatluna_conversation: [],
        chatluna_binding: [],
        chatluna_archive: [],
        chatluna_message: [],
        chatluna_constraint: [],
        chatluna_acl: [],
        chathub_room_member: [],
        chathub_room_group_member: [],
        chathub_user: [],
        chathub_room: [],
        chathub_message: [],
        chathub_conversation: []
    }

    async get(table: string, query: Record<string, unknown>) {
        return (this.tables[table] ?? []).filter((row) =>
            Object.entries(query).every(([key, expected]) => {
                const actual = row[key]

                if (
                    expected != null &&
                    typeof expected === 'object' &&
                    '$in' in expected
                ) {
                    return Array.isArray(expected.$in)
                        ? expected.$in.includes(actual)
                        : false
                }

                if (Array.isArray(expected)) {
                    return expected.includes(actual)
                }

                return actual === expected
            })
        )
    }

    async create(table: string, row: TableRow) {
        ;(this.tables[table] ??= []).push({ ...row })
    }

    async upsert(table: string, rows: TableRow[]) {
        const target = (this.tables[table] ??= [])

        for (const row of rows) {
            const index = target.findIndex((current) =>
                this.samePrimary(table, current, row)
            )
            if (index >= 0) {
                target[index] = { ...target[index], ...row }
            } else {
                target.push({ ...row })
            }
        }
    }

    async remove(table: string, query: Record<string, unknown>) {
        const target = (this.tables[table] ??= [])
        this.tables[table] = target.filter(
            (row) =>
                !Object.entries(query).every(([key, expected]) => {
                    const actual = row[key]
                    if (Array.isArray(expected)) {
                        return expected.includes(actual)
                    }
                    return actual === expected
                })
        )
    }

    async drop(table: string) {
        this.tables[table] = []
    }

    private samePrimary(table: string, left: TableRow, right: TableRow) {
        if (table === 'chatluna_binding') {
            return left.bindingKey === right.bindingKey
        }

        if (table === 'chatluna_archive') {
            return left.id === right.id
        }

        if (table === 'chatluna_message') {
            return left.id === right.id
        }

        if (table === 'chatluna_constraint') {
            return left.id != null && left.id === right.id
        }

        if (table === 'chatluna_meta') {
            return left.key === right.key
        }

        if (table === 'chatluna_acl') {
            return (
                left.conversationId === right.conversationId &&
                left.principalType === right.principalType &&
                left.principalId === right.principalId &&
                left.permission === right.permission
            )
        }

        return left.id === right.id
    }
}

function createSession(overrides: Partial<BindingSessionShape> = {}) {
    return {
        platform: 'discord',
        selfId: 'bot',
        guildId: 'guild',
        channelId: 'channel',
        userId: 'user',
        sid: 'discord:channel:user',
        isDirect: false,
        authority: 3,
        ...overrides
    } as BindingSessionShape as never
}

function createConfig(overrides: Record<string, unknown> = {}) {
    return {
        defaultModel: 'test-platform/test-model',
        defaultPreset: 'default-preset',
        defaultChatMode: 'plugin',
        defaultGroupRouteMode: 'shared',
        ...overrides
    } as never
}

async function createService(
    options: {
        tables?: Partial<Tables>
        baseDir?: string
        clearCache?: (conversation: ConversationRecord) => Promise<void>
        config?: Record<string, unknown>
    } = {}
) {
    const database = new FakeDatabase()
    const events: { name: string; args: unknown[] }[] = []

    for (const [table, rows] of Object.entries(options.tables ?? {})) {
        database.tables[table] = (rows ?? []).map((row) => ({ ...row }))
    }

    const clearCacheCalls: string[] = []
    const ctx = {
        database,
        logger: {
            info: () => {},
            error: () => {},
            warn: () => {},
            debug: () => {},
            success: () => {}
        },
        baseDir:
            options.baseDir ??
            (await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-core-test-'))),
        root: {
            parallel: async (name: string, ...args: unknown[]) => {
                events.push({ name, args })
            }
        },
        chatluna: {
            conversation: {
                getArchive: async (id: string) =>
                    database.tables.chatluna_archive.find(
                        (item) => item.id === id
                    ) as ArchiveRecord | undefined
            },
            conversationRuntime: {
                clearConversationInterface: async (
                    conversation: ConversationRecord
                ) => {
                    clearCacheCalls.push(conversation.id)
                    await options.clearCache?.(conversation)
                    return true
                }
            }
        }
    } as never

    const service = new ConversationService(ctx, createConfig(options.config))

    return {
        service,
        database,
        ctx,
        clearCacheCalls,
        events
    }
}

function createConversation(
    overrides: Partial<ConversationRecord> = {}
): ConversationRecord {
    const now = new Date('2026-03-21T00:00:00.000Z')

    return {
        id: 'conversation-1',
        seq: 1,
        bindingKey: 'shared:discord:bot:guild',
        title: 'Conversation 1',
        model: 'test-platform/test-model',
        preset: 'default-preset',
        chatMode: 'plugin',
        createdBy: 'user',
        createdAt: now,
        updatedAt: now,
        lastChatAt: now,
        status: 'active',
        latestMessageId: 'message-2',
        additional_kwargs: null,
        compression: null,
        archivedAt: null,
        archiveId: null,
        legacyRoomId: null,
        legacyMeta: null,
        ...overrides
    }
}

function createMessage(overrides: Partial<MessageRecord> = {}): MessageRecord {
    return {
        id: 'message-1',
        conversationId: 'conversation-1',
        parentId: null,
        role: 'human',
        text: 'hello',
        content: null,
        name: 'user',
        tool_call_id: null,
        tool_calls: null,
        additional_kwargs: null,
        additional_kwargs_binary: null,
        rawId: null,
        createdAt: new Date('2026-03-21T00:00:00.000Z'),
        ...overrides
    }
}

test('conversation-first runtime removes legacy room entry points from active source tree', async () => {
    const coreSrc = path.resolve(import.meta.dirname, '../src')

    await Promise.all([
        assert.rejects(fs.access(path.join(coreSrc, 'chains', 'rooms.ts'))),
        assert.rejects(fs.access(path.join(coreSrc, 'commands', 'room.ts'))),
        assert.rejects(fs.access(path.join(coreSrc, 'middlewares', 'room'))),
        assert.rejects(
            fs.access(path.join(coreSrc, 'middlewares', 'auth', 'mute_user.ts'))
        ),
        assert.rejects(
            fs.access(
                path.join(coreSrc, 'middlewares', 'model', 'request_model.ts')
            )
        ),
        assert.rejects(fs.access(path.join(coreSrc, 'legacy', 'types.ts')))
    ])
})

test('computeBaseBindingKey builds personal direct bindings', () => {
    const bindingKey = computeBaseBindingKey(
        {
            platform: 'discord',
            selfId: 'bot',
            guildId: 'guild',
            userId: 'user',
            isDirect: true
        } as BindingSessionShape as never,
        'personal'
    )

    assert.equal(bindingKey, 'personal:discord:bot:direct:user')
})

test('computeBaseBindingKey builds shared guild bindings', () => {
    const bindingKey = computeBaseBindingKey(
        {
            platform: 'discord',
            selfId: 'bot',
            guildId: 'guild',
            userId: 'user',
            isDirect: false
        } as BindingSessionShape as never,
        'shared'
    )

    assert.equal(bindingKey, 'shared:discord:bot:guild')
})

test('applyPresetLane appends preset lane when provided', () => {
    assert.equal(
        applyPresetLane('personal:discord:bot:guild:user', 'helper'),
        'personal:discord:bot:guild:user:preset:helper'
    )
    assert.equal(
        applyPresetLane('personal:discord:bot:guild:user', undefined),
        'personal:discord:bot:guild:user'
    )
})

test('parsePresetLaneInput normalizes alias prefixes and bare queries', () => {
    assert.deepEqual(
        parsePresetLaneInput('Sydney: hello', ['sydney', 'helper']),
        {
            preset: 'sydney',
            content: 'hello',
            queryOnly: false
        }
    )
    assert.deepEqual(parsePresetLaneInput('helper，', ['sydney', 'helper']), {
        preset: 'helper',
        content: '',
        queryOnly: true
    })
    assert.equal(parsePresetLaneInput('plain message', ['sydney']), null)
})

test('pagination normalizes page and limit bounds', async () => {
    const pagination = new Pagination<number>({
        page: 1,
        limit: 2,
        formatItem: (item) => `item:${item}`,
        formatString: {
            top: 'top',
            bottom: 'bottom',
            pages: 'page [page]/[total]'
        }
    })

    await pagination.push([1, 2, 3], 'numbers')

    assert.deepEqual(await pagination.getPage(0, 0, 'numbers'), [1])
    assert.equal(
        await pagination.getFormattedPage(2, 2, 'numbers'),
        'top\nitem:3\nbottom\npage 2/2'
    )
})

test('gzip helpers round-trip archived payload content', async () => {
    const json = JSON.stringify({ text: 'hello', values: [1, 2, 3] })
    const compressed = await gzipEncode(json)
    const base64 = await gzipEncode(json, 'base64')
    const arrayBuffer = bufferToArrayBuffer(compressed)

    assert.equal(await gzipDecode(arrayBuffer), json)
    assert.equal(await gzipDecode(base64), json)
})

test('getMessageContent flattens structured text parts', () => {
    assert.equal(
        getMessageContent([
            { type: 'text', text: 'hello ' },
            { type: 'image_url', image_url: 'https://example.com/x.png' },
            { type: 'text', text: 'world' }
        ] as never),
        'hello world'
    )
})

test('ConversationService resolves routed constraints and preset lanes', async () => {
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

test('runRoomToConversationMigration migrates legacy rooms, messages, bindings, and ACL', async () => {
    const { ctx, database } = await createService({
        tables: {
            chathub_room: [
                {
                    roomId: 1,
                    roomName: 'Legacy Room',
                    roomMasterId: 'owner',
                    conversationId: 'legacy-conversation',
                    preset: 'legacy-preset',
                    model: 'legacy/model',
                    chatMode: 'plugin',
                    visibility: 'private',
                    password: 'secret',
                    autoUpdate: true,
                    updatedTime: new Date('2026-03-21T00:00:00.000Z')
                } as unknown as TableRow
            ],
            chathub_conversation: [
                {
                    id: 'legacy-conversation',
                    latestId: 'legacy-message-1',
                    additional_kwargs: '{"topic":"legacy"}',
                    updatedAt: new Date('2026-03-21T01:00:00.000Z')
                } as unknown as TableRow
            ],
            chathub_message: [
                {
                    id: 'legacy-message-1',
                    conversation: 'legacy-conversation',
                    parent: null,
                    role: 'human',
                    text: 'hello from legacy room',
                    content: null,
                    name: 'owner',
                    tool_call_id: null,
                    tool_calls: null,
                    additional_kwargs: null,
                    additional_kwargs_binary: null,
                    rawId: null
                } as unknown as TableRow
            ],
            chathub_room_member: [
                {
                    roomId: 1,
                    userId: 'owner',
                    roomPermission: 'owner',
                    mute: false
                } as unknown as TableRow,
                {
                    roomId: 1,
                    userId: 'guest',
                    roomPermission: 'member',
                    mute: false
                } as unknown as TableRow,
                {
                    roomId: 1,
                    userId: 'helper',
                    roomPermission: 'member',
                    mute: false
                } as unknown as TableRow
            ],
            chathub_room_group_member: [
                {
                    roomId: 1,
                    groupId: 'guild',
                    roomVisibility: 'private'
                } as unknown as TableRow,
                {
                    roomId: 1,
                    groupId: 'guild-2',
                    roomVisibility: 'private'
                } as unknown as TableRow
            ],
            chathub_user: [
                {
                    userId: 'owner',
                    groupId: 'guild',
                    defaultRoomId: 1
                } as unknown as TableRow
            ]
        }
    })

    await runRoomToConversationMigration(ctx, createConfig())

    const conversation = database.tables
        .chatluna_conversation[0] as ConversationRecord
    const binding = database.tables.chatluna_binding[0] as BindingRecord
    const message = database.tables.chatluna_message[0] as MessageRecord
    const meta = database.tables.chatluna_meta.find(
        (item) => item.key === 'validation_result'
    ) as { value?: string | null }

    assert.equal(conversation.id, 'legacy-conversation')
    assert.equal(conversation.bindingKey, 'custom:legacy:room:1')
    assert.equal(conversation.latestMessageId, 'legacy-message-1')
    assert.equal(conversation.legacyRoomId, 1)
    assert.equal(binding.activeConversationId, 'legacy-conversation')
    assert.equal(message.conversationId, 'legacy-conversation')
    assert.equal(database.tables.chatluna_acl.length, 6)
    assert.equal(JSON.parse(meta.value ?? '{}').passed, true)
})

test('inferLegacyGroupRouteModes preserves per-group legacy routing semantics', () => {
    const users = [
        { userId: 'a', groupId: 'g1', defaultRoomId: 1 },
        { userId: 'b', groupId: 'g1', defaultRoomId: 2 },
        { userId: 'c', groupId: 'g2', defaultRoomId: 3 }
    ]
    const rooms = [
        {
            roomId: 1,
            visibility: 'private'
        },
        {
            roomId: 2,
            visibility: 'private'
        },
        {
            roomId: 3,
            visibility: 'public'
        }
    ] as never
    const groups = [
        { roomId: 1, groupId: 'g1', roomVisibility: 'private' },
        { roomId: 2, groupId: 'g1', roomVisibility: 'private' },
        { roomId: 3, groupId: 'g2', roomVisibility: 'public' }
    ] as never

    const modes = inferLegacyGroupRouteModes(users as never, rooms, groups)

    assert.equal(
        createLegacyBindingKey(users[0] as never, modes),
        'personal:legacy:legacy:g1:a'
    )
    assert.equal(
        createLegacyBindingKey(users[1] as never, modes),
        'personal:legacy:legacy:g1:b'
    )
    assert.equal(
        createLegacyBindingKey(users[2] as never, modes),
        'shared:legacy:legacy:g2'
    )
})

test('ConversationService ensureActiveConversation creates conversation and binding on default route', async () => {
    const { service, database } = await createService()

    const resolved = await service.ensureActiveConversation(createSession())
    const binding = database.tables.chatluna_binding[0] as BindingRecord
    const conversation = database.tables
        .chatluna_conversation[0] as ConversationRecord

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

test('ConversationService restores archived current conversation automatically', async () => {
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

test('ConversationService does not auto-restore archived conversation without manage permission', async () => {
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

    await assert.rejects(
        service.ensureActiveConversation(createSession({ authority: 1 })),
        /administrator permission/
    )
})

test('ConversationService ensureActiveConversation respects personal default group route mode', async () => {
    const { service } = await createService({
        config: {
            defaultGroupRouteMode: 'personal'
        }
    })

    const resolved = await service.ensureActiveConversation(createSession())

    assert.equal(resolved.bindingKey, 'personal:discord:bot:guild:user')
    assert.equal(resolved.conversation.seq, 1)
})

test('ConversationService switches and resolves friendly conversation targets within the same binding', async () => {
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

test('ConversationService rejects ambiguous friendly conversation targets', async () => {
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

    await assert.rejects(
        service.switchConversation(createSession(), {
            targetConversation: 'Project'
        }),
        /Conversation target is ambiguous\./
    )
})

test('ConversationService exports, archives, and restores conversations with legacy migration fields', async () => {
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

test('ConversationService records compression metadata and use rejects fixed fields', async () => {
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

    await assert.rejects(
        service.updateConversationUsage(createSession(), {
            model: 'other-model'
        }),
        /fixed to fixed-model/
    )
})

test('ConversationService blocks raw id access outside route without ACL and allows manage ACL', async () => {
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

    await assert.rejects(
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

test('ConversationService resolves ACL-backed cross-route targetConversation', async () => {
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

test('getLegacySchemaSentinel resolves under baseDir', () => {
    assert.equal(
        getLegacySchemaSentinel('C:/chatluna-base'),
        path.resolve(
            'C:/chatluna-base',
            'data/chatluna/temp/legacy-schema-disabled.json'
        )
    )
})

test('getLegacySchemaSentinelDir matches resolved sentinel parent', () => {
    assert.equal(
        getLegacySchemaSentinelDir('C:/chatluna-base'),
        path.dirname(getLegacySchemaSentinel('C:/chatluna-base'))
    )
})

test('ConversationService upserts and removes ACL records coherently', async () => {
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

test('ConversationService emits conversation lifecycle events for switch archive restore delete and compression', async () => {
    const active = createConversation({ id: 'conversation-active', seq: 1 })
    const next = createConversation({
        id: 'conversation-next',
        seq: 2,
        title: 'Next Topic'
    })
    const { service, events } = await createService({
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
})

test('conversation cleanup listeners in downstream packages use conversation lifecycle events', async () => {
    const files = [
        path.resolve(
            import.meta.dirname,
            '../../extension-long-memory/src/service/memory.ts'
        ),
        path.resolve(
            import.meta.dirname,
            '../../extension-agent/src/service/skills.ts'
        ),
        path.resolve(
            import.meta.dirname,
            '../../extension-agent/src/cli/service.ts'
        ),
        path.resolve(
            import.meta.dirname,
            '../../extension-tools/src/plugins/todos.ts'
        )
    ]

    for (const file of files) {
        const content = await fs.readFile(file, 'utf8')
        assert.equal(content.includes('chatluna/clear-chat-history'), false)
        assert.equal(
            content.includes('chatluna/conversation-after-clear-history'),
            true
        )
    }
})

test('purgeArchivedConversation removes archive directory and clears both binding pointers', async () => {
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

    await assert.rejects(fs.access(archiveDir))
    assert.equal(database.tables.chatluna_conversation.length, 0)
    assert.equal(database.tables.chatluna_archive.length, 0)
    assert.equal(database.tables.chatluna_message.length, 0)
    assert.equal(database.tables.chatluna_acl.length, 0)
    assert.equal(database.tables.chatluna_binding[0].activeConversationId, null)
    assert.equal(database.tables.chatluna_binding[0].lastConversationId, null)
})

test('wipe source keeps legacy migration and runtime table cleanup wired in', async () => {
    const source = await fs.readFile(
        path.resolve(import.meta.dirname, '../src/middlewares/system/wipe.ts'),
        'utf8'
    )

    assert.match(source, /LEGACY_MIGRATION_TABLES/)
    assert.match(source, /LEGACY_RUNTIME_TABLES/)
    assert.match(source, /for \(const table of LEGACY_MIGRATION_TABLES\)/)
    assert.match(source, /for \(const table of LEGACY_RUNTIME_TABLES\)/)
})

test('ConversationService supports sampled end-to-end lifecycle flow', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-e2e-flow-'))
    const { service } = await createService({ baseDir: dir })
    const session = createSession()

    const created = await service.ensureActiveConversation(session, {
        presetLane: 'helper'
    })
    const listed = await service.listConversations(session, {
        presetLane: 'helper'
    })
    const renamed = await service.renameConversation(session, {
        conversationId: created.conversation.id,
        presetLane: 'helper',
        title: 'Helper Session'
    })
    const exported = await service.exportConversation(session, {
        conversationId: created.conversation.id,
        presetLane: 'helper'
    })
    const archived = await service.archiveConversation(session, {
        conversationId: created.conversation.id,
        presetLane: 'helper'
    })
    const restored = await service.restoreConversation(session, {
        conversationId: created.conversation.id,
        presetLane: 'helper'
    })
    const removed = await service.deleteConversation(session, {
        conversationId: created.conversation.id,
        presetLane: 'helper'
    })

    assert.equal(listed.length, 1)
    assert.equal(renamed.title, 'Helper Session')
    assert.equal(path.extname(exported.path), '.md')
    assert.equal(archived.conversation.status, 'archived')
    assert.equal(restored.status, 'active')
    assert.equal(removed.status, 'deleted')
})

test('ConversationRuntime registers, resolves, and stops active requests', () => {
    const runtime = new ConversationRuntime({} as never)
    const abortController = new AbortController()
    const session = createSession({ sid: 'sid-1' })

    runtime.registerRequest(
        'conversation-1',
        'request-1',
        'plugin',
        abortController,
        session
    )

    assert.equal(runtime.getRequestIdBySession(session), 'request-1')
    assert.equal(runtime.stopRequest('request-1'), true)
    assert.equal(abortController.signal.aborted, true)
    assert.equal(runtime.stopRequest('missing-request'), false)

    runtime.completeRequest('conversation-1', 'request-1', session)
    assert.equal(runtime.getRequestIdBySession(session), undefined)
})

test('ConversationRuntime appendPendingMessage waits for plugin round decisions', async () => {
    const runtime = new ConversationRuntime({} as never)
    const activeRequest = runtime.registerRequest(
        'conversation-1',
        'request-1',
        'plugin',
        new AbortController(),
        createSession()
    )

    const pushed: HumanMessage[] = []
    const originalPush = activeRequest.messageQueue.push.bind(
        activeRequest.messageQueue
    )
    activeRequest.messageQueue.push = ((message: HumanMessage) => {
        pushed.push(message)
        return originalPush(message)
    }) as typeof activeRequest.messageQueue.push

    const pending = runtime.appendPendingMessage(
        'conversation-1',
        new HumanMessage('follow-up')
    )

    assert.equal(activeRequest.roundDecisionResolvers.length, 1)
    activeRequest.roundDecisionResolvers[0](true)
    assert.equal(await pending, true)
    assert.equal(pushed.length, 1)
    assert.equal(String(pushed[0].content), 'follow-up')

    activeRequest.lastDecision = false
    assert.equal(
        await runtime.appendPendingMessage(
            'conversation-1',
            new HumanMessage('ignored'),
            'plugin'
        ),
        false
    )
    assert.equal(
        await runtime.appendPendingMessage(
            'conversation-1',
            new HumanMessage('wrong-mode'),
            'chat'
        ),
        false
    )
})

test('ConversationRuntime clears cached interfaces and dispatches compression', async () => {
    const cleared: string[] = []
    const compressed: boolean[] = []
    const runtime = new ConversationRuntime({
        createChatInterface: async () => ({
            clearChatHistory: async () => {
                cleared.push('cleared')
            },
            compressContext: async (force: boolean) => {
                compressed.push(force)
                return {
                    compressed: true,
                    inputTokens: 10,
                    outputTokens: 5,
                    reducedPercent: 50
                }
            }
        }),
        awaitLoadPlatform: async () => {},
        platform: {
            getClient: async () => ({
                value: {
                    configPool: {
                        getConfig: () => ({
                            value: {
                                concurrentMaxSize: 1
                            }
                        })
                    }
                }
            })
        },
        ctx: {
            root: {
                parallel: async () => {}
            }
        }
    } as never)

    const conversation = createConversation({
        id: 'conversation-runtime',
        model: 'platform/model'
    })

    await runtime.ensureChatInterface(conversation)
    assert.equal(runtime.getCachedConversations().length, 1)

    await runtime.clearConversationHistory(conversation)
    assert.deepEqual(cleared, ['cleared'])
    assert.equal(runtime.getCachedConversations().length, 0)

    const result = await runtime.compressConversation(conversation, true)
    assert.equal(result.compressed, true)
    assert.deepEqual(compressed, [true])
})

test('ConversationRuntime dispose clears platform-scoped and global state', () => {
    const runtime = new ConversationRuntime({} as never)
    const session = createSession({ sid: 'sid-dispose' })
    const conversation = createConversation({ id: 'conversation-dispose' })

    runtime.interfaces.set(conversation.id, {
        conversation,
        chatInterface: {} as never
    })
    runtime.registerPlatformConversation('platform-a', conversation.id)
    runtime.registerRequest(
        conversation.id,
        'request-dispose',
        'plugin',
        new AbortController(),
        session
    )

    runtime.dispose('platform-a')
    assert.equal(runtime.interfaces.has(conversation.id), false)
    assert.equal(runtime.activeByConversation.has(conversation.id), false)

    runtime.registerRequest(
        'conversation-2',
        'request-2',
        'plugin',
        new AbortController(),
        createSession({ sid: 'sid-2' })
    )
    runtime.dispose()
    assert.equal(runtime.requestsById.size, 0)
    assert.equal(runtime.requestBySession.size, 0)
    assert.equal(runtime.platformIndex.size, 0)
})
