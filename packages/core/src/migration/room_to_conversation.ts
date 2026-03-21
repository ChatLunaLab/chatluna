import type { Context } from 'koishi'
import type { Config } from '../config'
import type {
    ACLRecord,
    BindingRecord,
    ConversationRecord,
    MessageRecord
} from '../services/conversation_types'
import type {
    LegacyConversationRecord,
    LegacyMessageRecord,
    LegacyRoomGroupRecord,
    LegacyRoomMemberRecord,
    LegacyRoomRecord,
    LegacyUserRecord
} from '../services/types'
import {
    LEGACY_RETENTION_META_KEY,
    createLegacyTableRetention,
    createLegacyBindingKey,
    inferLegacyGroupRouteModes,
    isComplexRoom,
    readMetaValue,
    validateRoomMigration,
    writeMetaValue
} from './validators'

export const BUILTIN_SCHEMA_VERSION = 1

interface RoomProgress {
    lastRoomId: number
    migrated: number
}

interface MessageProgress {
    index: number
    lastId?: string
    migrated: number
}

interface BindingProgress {
    index: number
    migrated: number
}

export async function runRoomToConversationMigration(
    ctx: Context,
    config: Config
) {
    const schemaVersion =
        (await readMetaValue<number>(ctx, 'schema_version')) ?? 0
    const roomDone =
        (await readMetaValue<boolean>(ctx, 'room_migration_done')) ?? false
    const messageDone =
        (await readMetaValue<boolean>(ctx, 'message_migration_done')) ?? false

    if (schemaVersion >= BUILTIN_SCHEMA_VERSION && roomDone && messageDone) {
        return await ensureMigrationValidated(ctx, config)
    }

    ctx.logger.info('Running built-in ChatLuna migration.')
    await writeMetaValue(ctx, 'migration_started_at', new Date().toISOString())
    await writeMetaValue(ctx, 'schema_version', BUILTIN_SCHEMA_VERSION)
    await writeMetaValue(
        ctx,
        'legacy_binding_route_mode',
        config.defaultGroupRouteMode
    )
    await writeMetaValue(
        ctx,
        LEGACY_RETENTION_META_KEY,
        createLegacyTableRetention('migration-visible')
    )

    await migrateRooms(ctx)
    await migrateMessages(ctx)
    await migrateBindings(ctx)

    const result = await validateRoomMigration(ctx, config)
    await writeMetaValue(ctx, 'validation_result', result)
    await writeMetaValue(ctx, 'migration_timestamp', new Date().toISOString())
    await writeMetaValue(ctx, 'room_migration_done', true)
    await writeMetaValue(ctx, 'message_migration_done', true)
    await writeMetaValue(ctx, 'migration_finished_at', new Date().toISOString())

    if (!result.passed) {
        throw new Error('ChatLuna migration validation failed.')
    }

    await writeMetaValue(
        ctx,
        LEGACY_RETENTION_META_KEY,
        createLegacyTableRetention('migration-visible')
    )

    ctx.logger.info('Built-in ChatLuna migration finished.')
    return result
}

export async function ensureMigrationValidated(ctx: Context, config: Config) {
    const result = await readMetaValue<
        Awaited<ReturnType<typeof validateRoomMigration>>
    >(ctx, 'validation_result')

    if (result?.passed === true) {
        await writeMetaValue(
            ctx,
            LEGACY_RETENTION_META_KEY,
            createLegacyTableRetention('migration-visible')
        )
        return result
    }

    const schemaVersion =
        (await readMetaValue<number>(ctx, 'schema_version')) ?? 0
    const roomDone =
        (await readMetaValue<boolean>(ctx, 'room_migration_done')) ?? false
    const messageDone =
        (await readMetaValue<boolean>(ctx, 'message_migration_done')) ?? false

    if (
        schemaVersion < BUILTIN_SCHEMA_VERSION ||
        roomDone !== true ||
        messageDone !== true
    ) {
        return runRoomToConversationMigration(ctx, config)
    }

    const validated = await validateRoomMigration(ctx, config)
    await writeMetaValue(ctx, 'validation_result', validated)

    if (!validated.passed) {
        throw new Error('ChatLuna migration validation failed.')
    }

    await writeMetaValue(
        ctx,
        LEGACY_RETENTION_META_KEY,
        createLegacyTableRetention('migration-visible')
    )

    return validated
}

async function migrateRooms(ctx: Context) {
    const done =
        (await readMetaValue<boolean>(ctx, 'room_migration_done')) ?? false

    if (done) {
        return
    }

    const rooms = (
        (await ctx.database.get('chathub_room', {})) as LegacyRoomRecord[]
    )
        .filter(
            (room) =>
                room.conversationId != null &&
                room.conversationId !== '' &&
                room.conversationId !== '0'
        )
        .sort((a, b) => a.roomId - b.roomId)
    const oldConversations = (await ctx.database.get(
        'chathub_conversation',
        {}
    )) as LegacyConversationRecord[]
    const members = (await ctx.database.get(
        'chathub_room_member',
        {}
    )) as LegacyRoomMemberRecord[]
    const groups = (await ctx.database.get(
        'chathub_room_group_member',
        {}
    )) as LegacyRoomGroupRecord[]
    const users = (await ctx.database.get(
        'chathub_user',
        {}
    )) as LegacyUserRecord[]
    const routeModes = inferLegacyGroupRouteModes(users, rooms, groups)
    const existing = (await ctx.database.get(
        'chatluna_conversation',
        {}
    )) as ConversationRecord[]
    const existingMap = new Map(existing.map((item) => [item.id, item]))
    const progress = (await readMetaValue<RoomProgress>(
        ctx,
        'conversation_migration_progress'
    )) ?? {
        lastRoomId: 0,
        migrated: existing.length
    }

    let seq = existing.reduce((max, item) => Math.max(max, item.seq ?? 0), 0)

    for (const room of rooms) {
        if (room.roomId <= progress.lastRoomId) {
            continue
        }

        const oldConversation = oldConversations.find(
            (item) => item.id === room.conversationId
        )
        const current = existingMap.get(room.conversationId as string)
        const roomMembers = members.filter(
            (item) => item.roomId === room.roomId
        )
        const roomGroups = groups.filter((item) => item.roomId === room.roomId)
        const bindingKey = resolveRoomBindingKey(
            room,
            roomMembers,
            roomGroups,
            routeModes
        )
        const updatedAt =
            oldConversation?.updatedAt != null &&
            oldConversation.updatedAt.getTime() > room.updatedTime.getTime()
                ? oldConversation.updatedAt
                : room.updatedTime

        const conversationSeq = current?.seq ?? seq + 1
        if (current?.seq == null) {
            seq = conversationSeq
        }

        const conversation: ConversationRecord = {
            id: room.conversationId as string,
            seq: conversationSeq,
            bindingKey,
            title: room.roomName,
            model: room.model,
            preset: room.preset,
            chatMode: room.chatMode,
            createdBy: room.roomMasterId,
            createdAt: room.updatedTime,
            updatedAt,
            lastChatAt: oldConversation?.updatedAt ?? room.updatedTime,
            status: 'active',
            latestMessageId: oldConversation?.latestId ?? null,
            additional_kwargs: oldConversation?.additional_kwargs ?? null,
            compression: null,
            archivedAt: null,
            archiveId: null,
            legacyRoomId: room.roomId,
            legacyMeta: JSON.stringify({
                visibility: room.visibility,
                password: room.password ?? null,
                autoUpdate: room.autoUpdate ?? false,
                roomMasterId: room.roomMasterId,
                groups: roomGroups.map((item) => item.groupId),
                members: roomMembers.map((item) => ({
                    userId: item.userId,
                    roomPermission: item.roomPermission,
                    mute: item.mute ?? false
                }))
            })
        }

        await ctx.database.upsert('chatluna_conversation', [conversation])
        existingMap.set(conversation.id, conversation)

        const acl = buildAclRecords(room, roomMembers, roomGroups)
        if (acl.length > 0) {
            await ctx.database.upsert('chatluna_acl', acl)
        }

        progress.lastRoomId = room.roomId
        progress.migrated += 1
        await writeMetaValue(ctx, 'conversation_migration_progress', progress)
    }
}

async function migrateMessages(ctx: Context) {
    const done =
        (await readMetaValue<boolean>(ctx, 'message_migration_done')) ?? false

    if (done) {
        return
    }

    const oldMessages = (await ctx.database.get(
        'chathub_message',
        {}
    )) as LegacyMessageRecord[]
    const progress = (await readMetaValue<MessageProgress>(
        ctx,
        'message_migration_progress'
    )) ?? {
        index: 0,
        migrated: 0
    }

    const batchSize = 500

    for (let i = progress.index; i < oldMessages.length; i += batchSize) {
        const batch = oldMessages.slice(i, i + batchSize)
        const payload = batch.map((item) => ({
            id: item.id,
            conversationId: item.conversation,
            parentId: item.parent ?? null,
            role: item.role,
            text: typeof item.text === 'string' ? item.text : null,
            content: item.content ?? null,
            name: item.name ?? null,
            tool_call_id: item.tool_call_id ?? null,
            tool_calls: item.tool_calls,
            additional_kwargs: item.additional_kwargs ?? null,
            additional_kwargs_binary: item.additional_kwargs_binary ?? null,
            rawId: item.rawId ?? null,
            createdAt: null
        })) satisfies MessageRecord[]

        if (payload.length > 0) {
            await ctx.database.upsert('chatluna_message', payload)
        }

        progress.index = i + batch.length
        progress.lastId = batch[batch.length - 1]?.id
        progress.migrated += batch.length
        await writeMetaValue(ctx, 'message_migration_progress', progress)
    }
}

async function migrateBindings(ctx: Context) {
    const users = (
        (await ctx.database.get('chathub_user', {})) as LegacyUserRecord[]
    ).sort((a, b) =>
        `${a.groupId ?? '0'}:${a.userId}`.localeCompare(
            `${b.groupId ?? '0'}:${b.userId}`
        )
    )
    const conversations = (await ctx.database.get(
        'chatluna_conversation',
        {}
    )) as ConversationRecord[]
    const rooms = (await ctx.database.get(
        'chathub_room',
        {}
    )) as LegacyRoomRecord[]
    const groups = (await ctx.database.get(
        'chathub_room_group_member',
        {}
    )) as LegacyRoomGroupRecord[]
    const routeModes = inferLegacyGroupRouteModes(users, rooms, groups)
    const progress = (await readMetaValue<BindingProgress>(
        ctx,
        'binding_migration_progress'
    )) ?? {
        index: 0,
        migrated: 0
    }

    for (let i = progress.index; i < users.length; i++) {
        const user = users[i]
        const conversation = conversations.find(
            (item) => item.legacyRoomId === user.defaultRoomId
        )

        progress.index = i + 1

        if (conversation == null) {
            await writeMetaValue(ctx, 'binding_migration_progress', progress)
            continue
        }

        const bindingKey = createLegacyBindingKey(user, routeModes)
        const current = (
            (await ctx.database.get('chatluna_binding', {
                bindingKey
            })) as BindingRecord[]
        )[0]

        await ctx.database.upsert('chatluna_binding', [
            {
                bindingKey,
                activeConversationId: conversation.id,
                lastConversationId:
                    current?.activeConversationId &&
                    current.activeConversationId !== conversation.id
                        ? current.activeConversationId
                        : (current?.lastConversationId ?? null),
                updatedAt: new Date()
            }
        ])

        progress.migrated += 1
        await writeMetaValue(ctx, 'binding_migration_progress', progress)
    }
}

function resolveRoomBindingKey(
    room: LegacyRoomRecord,
    members: LegacyRoomMemberRecord[],
    groups: LegacyRoomGroupRecord[],
    routeModes: Map<string, 'shared' | 'personal'>
) {
    if (isComplexRoom(room, members, groups)) {
        return `custom:legacy:room:${room.roomId}`
    }

    const groupId = groups[0]?.groupId
    const userId = members[0]?.userId ?? room.roomMasterId

    if (groupId == null || groupId.length === 0) {
        return `personal:legacy:legacy:direct:${userId}`
    }

    if (
        groups.length === 1 &&
        (room.visibility === 'public' || room.visibility === 'template_clone')
    ) {
        return `shared:legacy:legacy:${groupId}`
    }

    if ((routeModes.get(groupId) ?? 'personal') === 'shared') {
        return `shared:legacy:legacy:${groupId}`
    }

    return `personal:legacy:legacy:${groupId}:${userId}`
}

function buildAclRecords(
    room: LegacyRoomRecord,
    members: LegacyRoomMemberRecord[],
    groups: LegacyRoomGroupRecord[]
) {
    if (!isComplexRoom(room, members, groups)) {
        return []
    }

    const conversationId = room.conversationId as string
    const map = new Map<string, ACLRecord>()

    for (const member of members) {
        addAclRecord(map, {
            conversationId,
            principalType: 'user',
            principalId: member.userId,
            permission: 'view'
        })

        if (
            member.roomPermission === 'owner' ||
            member.roomPermission === 'admin'
        ) {
            addAclRecord(map, {
                conversationId,
                principalType: 'user',
                principalId: member.userId,
                permission: 'manage'
            })
        }
    }

    for (const group of groups) {
        addAclRecord(map, {
            conversationId,
            principalType: 'guild',
            principalId: group.groupId,
            permission: 'view'
        })
    }

    addAclRecord(map, {
        conversationId,
        principalType: 'user',
        principalId: room.roomMasterId,
        permission: 'manage'
    })

    return Array.from(map.values())
}

function addAclRecord(map: Map<string, ACLRecord>, record: ACLRecord) {
    map.set(
        `${record.conversationId}:${record.principalType}:${record.principalId}:${record.permission}`,
        record
    )
}
