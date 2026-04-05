/// <reference types="mocha" />

import { assert } from 'chai'
import path from 'node:path'
import {
    createLegacyBindingKey,
    inferLegacyGroupRouteModes
} from '../src/migration/validators'
import {
    getLegacySchemaSentinel,
    getLegacySchemaSentinelDir
} from '../src/migration/legacy_tables'
import { runRoomToConversationMigration } from '../src/migration/room_to_conversation'
import { createConfig, createService, type TableRow } from './helpers'
import type {
    BindingRecord,
    ConversationRecord,
    MessageRecord
} from '../src/services/conversation_types'

it('runRoomToConversationMigration migrates legacy rooms, messages, bindings, and ACL', async () => {
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

it('inferLegacyGroupRouteModes preserves per-group legacy routing semantics', () => {
    const users = [
        { userId: 'a', groupId: 'g1', defaultRoomId: 1 },
        { userId: 'b', groupId: 'g1', defaultRoomId: 2 },
        { userId: 'c', groupId: 'g2', defaultRoomId: 3 }
    ]
    const rooms = [
        { roomId: 1, visibility: 'private' },
        { roomId: 2, visibility: 'private' },
        { roomId: 3, visibility: 'public' }
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

it('getLegacySchemaSentinel resolves under baseDir', () => {
    assert.equal(
        getLegacySchemaSentinel('C:/chatluna-base'),
        path.resolve(
            'C:/chatluna-base',
            'data/chatluna/temp/legacy-schema-disabled.json'
        )
    )
})

it('getLegacySchemaSentinelDir matches resolved sentinel parent', () => {
    assert.equal(
        getLegacySchemaSentinelDir('C:/chatluna-base'),
        path.dirname(getLegacySchemaSentinel('C:/chatluna-base'))
    )
})
