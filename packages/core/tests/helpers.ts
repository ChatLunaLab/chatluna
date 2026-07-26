import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assert } from 'chai'
import memory from '@koishijs/plugin-database-memory'
import { Context } from 'koishi'
import type {} from '../src/services/types'
import {
    type ArchiveRecord,
    type ConversationRecord,
    type MessageRecord
} from '../src/types'
import { ChatLunaService } from '../src/services/chat'
import { ConversationService } from '../src/services/conversation'
import { ModelType } from '../src/llm-core/platform/types'

export async function expectRejected(
    promise: Promise<unknown>,
    pattern?: RegExp
) {
    try {
        await promise
    } catch (err) {
        if (pattern != null) {
            const text =
                err instanceof Error
                    ? [
                          err.message,
                          (err as { originError?: Error }).originError
                              ?.message ?? ''
                      ].join('\n')
                    : String(err)
            assert.match(text, pattern)
        }
        return
    }

    assert.fail('Expected promise to reject.')
}

export type BindingSessionShape = {
    platform?: string
    selfId?: string
    guildId?: string
    userId?: string
    channelId?: string
    sid?: string
    isDirect?: boolean
    authority?: number
}

export type TableRow = Record<string, unknown>
export type Tables = Record<string, TableRow[]>

type QueryOptions = {
    offset?: number
    limit?: number
    sort?: Record<string, 'asc' | 'desc'> | [string, 'asc' | 'desc'][]
}

export class FakeDatabase {
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

    extend(table: string) {
        this.tables[table] ??= []
    }

    async get(
        table: string,
        query: Record<string, unknown>,
        modifier: QueryOptions | string[] = {}
    ) {
        const filters = { ...query }
        const options = Array.isArray(modifier) ? {} : { ...modifier }

        if ('$offset' in filters) {
            options.offset = Number(filters.$offset)
            delete filters.$offset
        }

        if ('$limit' in filters) {
            options.limit = Number(filters.$limit)
            delete filters.$limit
        }

        if ('$sort' in filters) {
            options.sort = filters.$sort as QueryOptions['sort']
            delete filters.$sort
        }

        let rows = (this.tables[table] ?? []).filter((row) =>
            Object.entries(filters).every(([key, expected]) => {
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

        const sortEntries = Array.isArray(options.sort)
            ? options.sort
            : Object.entries(options.sort ?? {})
        const [sortKey, sortDir] = sortEntries[0] ?? []

        if (sortKey != null && sortDir != null) {
            rows = [...rows].sort((left, right) => {
                const a = left[sortKey]
                const b = right[sortKey]

                if (a === b) {
                    return 0
                }

                if (a == null) {
                    return sortDir === 'asc' ? -1 : 1
                }

                if (b == null) {
                    return sortDir === 'asc' ? 1 : -1
                }

                return (a < b ? -1 : 1) * (sortDir === 'asc' ? 1 : -1)
            })
        }

        const offset = Number.isFinite(options.offset)
            ? Math.max(0, Number(options.offset))
            : 0
        const limit = Number.isFinite(options.limit)
            ? Math.max(0, Number(options.limit))
            : undefined
        rows =
            limit == null
                ? rows.slice(offset)
                : rows.slice(offset, offset + limit)

        if (Array.isArray(modifier)) {
            return rows.map((row) =>
                Object.fromEntries(modifier.map((field) => [field, row[field]]))
            )
        }

        return rows
    }

    async create(table: string, row: TableRow) {
        ;(this.tables[table] ??= []).push({ ...row })
    }

    async upsert(table: string, rows: TableRow[]) {
        const target = (this.tables[table] ??= [])

        for (const row of rows) {
            const idx = target.findIndex((current) =>
                this.samePrimary(table, current, row)
            )
            if (idx >= 0) {
                target[idx] = { ...target[idx], ...row }
            } else {
                target.push({ ...row })
            }
        }
    }

    async set(
        table: string,
        query: Record<string, unknown>,
        update: Record<string, unknown>
    ) {
        const target = (this.tables[table] ??= [])

        for (let idx = 0; idx < target.length; idx += 1) {
            if (
                Object.entries(query).every(
                    ([key, expected]) => target[idx][key] === expected
                )
            ) {
                target[idx] = { ...target[idx], ...update }
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
            return (
                (left.id != null && left.id === right.id) ||
                left.name === right.name
            )
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

export function createSession(overrides: Partial<BindingSessionShape> = {}) {
    const authority = overrides.authority ?? 3

    return {
        platform: 'discord',
        selfId: 'bot',
        guildId: 'guild',
        channelId: 'channel',
        userId: 'user',
        sid: 'discord:channel:user',
        isDirect: false,
        authority,
        app: {
            permissions: {
                test: async () => authority >= 3
            },
            logger: {
                debug: () => {}
            }
        },
        getUser: async () => ({
            authority
        }),
        ...overrides
    } as BindingSessionShape as never
}

export function createConfig(overrides: Record<string, unknown> = {}) {
    return {
        defaultModel: 'test-platform/test-model',
        defaultPreset: 'default-preset',
        defaultChatMode: 'plugin',
        defaultGroupRouteMode: 'shared',
        autoUpdateConversationModel: false,
        enablePresetKeywordTrigger: true,
        ...overrides
    } as never
}

export async function createService(
    options: {
        tables?: Partial<Tables>
        baseDir?: string
        clearCache?: (conversation: ConversationRecord) => Promise<void>
        config?: Record<string, unknown>
    } = {}
) {
    const database = new FakeDatabase()
    const events: { name: string; args: unknown[] }[] = []
    const syncCalls: string[] = []

    for (const [table, rows] of Object.entries(options.tables ?? {})) {
        database.tables[table] = (rows ?? []).map((row) => ({ ...row }))
    }

    const clearCacheCalls: string[] = []
    const clearConversation = async (conversation: ConversationRecord) => {
        clearCacheCalls.push(conversation.id)
        await options.clearCache?.(conversation)
        return true
    }
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
            platform: {
                chatChains: {
                    value: [{ name: 'plugin' }]
                },
                listPlatformModels: (platform: string) => ({
                    value:
                        platform === 'test-platform'
                            ? [
                                  {
                                      name: 'test-model',
                                      type: ModelType.llm,
                                      maxTokens: 4096,
                                      capabilities: []
                                  }
                              ]
                            : []
                })
            },
            preset: {
                getPreset: (name: string, _throwOnMissing = true) => ({
                    value: {
                        triggerKeyword: [name],
                        rawText: '',
                        messages: [],
                        config: {}
                    }
                })
            },
            conversation: {
                getArchive: async (id: string) =>
                    database.tables.chatluna_archive.find(
                        (item) => item.id === id
                    ) as ArchiveRecord | undefined
            },
            conversationRuntime: {
                withConversationSync: async (
                    conversation: ConversationRecord,
                    callback: () => Promise<unknown>
                ) => {
                    syncCalls.push(conversation.id)
                    return callback()
                },
                clearConversationInterfaceLocked: clearConversation,
                clearConversationInterface: async (
                    conversation: ConversationRecord
                ) => clearConversation(conversation)
            }
        }
    } as never

    const service = new ConversationService(
        ctx,
        createConfig(options.config),
        ctx.chatluna.conversationRuntime,
        ctx.chatluna.platform,
        ctx.chatluna.preset
    )

    return {
        service,
        database,
        ctx,
        clearCacheCalls,
        syncCalls,
        events
    }
}

export async function createMemoryService(
    options: {
        tables?: Partial<Tables>
        config?: Record<string, unknown>
        baseDir?: string
    } = {}
) {
    const app = new Context()
    app.baseDir =
        options.baseDir ??
        (await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-core-test-')))
    app.plugin(memory)
    app.plugin(ChatLunaService, createConfig(options.config))
    await app.start()
    app.chatluna.platform.registerChatChain('plugin', {}, () => ({}) as never)
    ;(
        app.chatluna.platform as unknown as {
            _models: Record<string, unknown[]>
        }
    )._models['test-platform'] = [
        {
            name: 'test-model',
            type: ModelType.llm,
            maxTokens: 4096,
            capabilities: []
        }
    ]

    for (const [table, rows] of Object.entries(options.tables ?? {})) {
        for (const row of rows ?? []) {
            await app.database.create(table as never, row as never)
        }
    }

    return {
        app,
        ctx: app,
        database: app.database,
        service: app.chatluna.conversation
    }
}

export function createConversation(
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

export function createMessage(
    overrides: Partial<MessageRecord> = {}
): MessageRecord {
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
        additional_kwargs_binary: null,
        response_metadata_binary: null,
        rawId: null,
        createdAt: new Date('2026-03-21T00:00:00.000Z'),
        ...overrides
    }
}
