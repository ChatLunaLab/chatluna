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
import type { BindingProgress, MessageProgress, RoomProgress } from './types'
import {
    aclKey,
    createLegacyBindingKey,
    createLegacyTableRetention,
    filterValidRooms,
    inferLegacyGroupRouteModes,
    isComplexRoom,
    LEGACY_RETENTION_META_KEY,
    purgeLegacyTables,
    readMetaValue,
    resolveRoomBindingKey,
    validateRoomMigration,
    writeMetaValue
} from './validators'

export const BUILTIN_SCHEMA_VERSION = 1

// (#11) module-level tuning constant
const MESSAGE_BATCH_SIZE = 500
// (#8) write progress at most every N bindings to reduce I/O
const BINDING_PROGRESS_BATCH = 50

export async function runRoomToConversationMigration(
    ctx: Context,
    config: Config
) {
    const result = await readMetaValue<
        Awaited<ReturnType<typeof validateRoomMigration>>
    >(ctx, 'validation_result')
    const schemaVersion =
        (await readMetaValue<number>(ctx, 'schema_version')) ?? 0
    const roomDone =
        (await readMetaValue<boolean>(ctx, 'room_migration_done')) ?? false
    const messageDone =
        (await readMetaValue<boolean>(ctx, 'message_migration_done')) ?? false

    if (
        schemaVersion >= BUILTIN_SCHEMA_VERSION &&
        (result?.passed === true || (roomDone && messageDone))
    ) {
        return await ensureMigrationValidated(ctx, config)
    }

    ctx.logger.info('Running built-in ChatLuna migration.')
    // (#15) only one start timestamp needed
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

    const validated = await validateRoomMigration(ctx, config)
    await writeMetaValue(ctx, 'validation_result', validated)

    if (!validated.passed) {
        throw new Error('ChatLuna migration validation failed.')
    }

    await purgeLegacyTables(ctx)
    await writeMigrationFinished(ctx)

    ctx.logger.info('Built-in ChatLuna migration finished.')
    return validated
}

// (#13) guard against re-entrant call: ensureMigrationValidated only calls
// runRoomToConversationMigration when flags indicate migration is incomplete,
// while runRoomToConversationMigration only calls ensureMigrationValidated when
// flags indicate it IS complete — so the two paths are mutually exclusive.
export async function ensureMigrationValidated(ctx: Context, config: Config) {
    const result = await readMetaValue<
        Awaited<ReturnType<typeof validateRoomMigration>>
    >(ctx, 'validation_result')
    const retention = await readMetaValue<{
        state?: string
    }>(ctx, LEGACY_RETENTION_META_KEY)

    if (result?.passed === true) {
        if (retention?.state !== 'purged') {
            await purgeLegacyTables(ctx)
        }

        await writeMigrationFinished(ctx)
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
        // Migration is genuinely incomplete; restart it.
        // runRoomToConversationMigration will NOT call back into ensureMigrationValidated
        // because it only does so when all done-flags are true, which they are not here.
        return runRoomToConversationMigration(ctx, config)
    }

    const validated = await validateRoomMigration(ctx, config)
    await writeMetaValue(ctx, 'validation_result', validated)

    if (!validated.passed) {
        throw new Error('ChatLuna migration validation failed.')
    }

    await purgeLegacyTables(ctx)
    await writeMigrationFinished(ctx)

    return validated
}

async function writeMigrationFinished(ctx: Context) {
    await writeMetaValue(ctx, 'migration_finished_at', new Date().toISOString())
    await writeMetaValue(ctx, 'room_migration_done', true)
    await writeMetaValue(ctx, 'message_migration_done', true)
    await writeMetaValue(
        ctx,
        LEGACY_RETENTION_META_KEY,
        createLegacyTableRetention('purged')
    )
}

// (#6) removed redundant inner `done` check — the caller already guards on room_migration_done
async function migrateRooms(ctx: Context) {
    const rooms = filterValidRooms(
        (await ctx.database.get('chathub_room', {})) as LegacyRoomRecord[]
    ).sort((a, b) => a.roomId - b.roomId)

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

    // (#9) key by legacyRoomId to avoid conversationId collisions across multiple rooms
    const existingByRoomId = new Map(
        existing
            .filter((item) => item.legacyRoomId != null)
            .map((item) => [item.legacyRoomId!, item])
    )
    // (#10) only count records that were actually migrated from legacy rooms
    const progress = (await readMetaValue<RoomProgress>(
        ctx,
        'conversation_migration_progress'
    )) ?? {
        lastRoomId: 0,
        migrated: existing.filter((item) => item.legacyRoomId != null).length
    }

    let seq = existing.reduce((max, item) => Math.max(max, item.seq ?? 0), 0)

    for (const room of rooms) {
        if (room.roomId <= progress.lastRoomId) {
            continue
        }

        const oldConversation = oldConversations.find(
            (item) => item.id === room.conversationId
        )
        const current = existingByRoomId.get(room.roomId)
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
            // filterValidRooms() guarantees conversationId is present here.
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
        existingByRoomId.set(room.roomId, conversation)

        const acl = buildAclRecords(room, roomMembers, roomGroups)
        if (acl.length > 0) {
            await ctx.database.upsert('chatluna_acl', acl)
        }

        progress.lastRoomId = room.roomId
        progress.migrated += 1
        await writeMetaValue(ctx, 'conversation_migration_progress', progress)
    }
}

// (#7) removed redundant inner `done` check
async function migrateMessages(ctx: Context) {
    const progress = (await readMetaValue<MessageProgress>(
        ctx,
        'message_migration_progress'
    )) ?? {
        index: 0,
        migrated: 0
    }

    while (true) {
        const batch = (await ctx.database.get(
            'chathub_message',
            {},
            {
                offset: progress.index,
                limit: MESSAGE_BATCH_SIZE,
                sort: {
                    id: 'asc'
                }
            }
        )) as LegacyMessageRecord[]

        if (batch.length === 0) {
            break
        }

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

        await ctx.database.upsert('chatluna_message', payload)

        progress.index += batch.length
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
    const conversationsByRoomId = new Map(
        conversations
            .filter((item) => item.legacyRoomId != null)
            .map((item) => [item.legacyRoomId!, item])
    )
    const progress = (await readMetaValue<BindingProgress>(
        ctx,
        'binding_migration_progress'
    )) ?? {
        index: 0,
        migrated: 0
    }

    for (let i = progress.index; i < users.length; i++) {
        const user = users[i]
        const conversation = conversationsByRoomId.get(user.defaultRoomId)

        progress.index = i + 1

        if (conversation == null) {
            // (#8) batch progress writes; flush at interval or at end
            if (i % BINDING_PROGRESS_BATCH === 0 || i === users.length - 1) {
                await writeMetaValue(
                    ctx,
                    'binding_migration_progress',
                    progress
                )
            }
            continue
        }

        const bindingKey = createLegacyBindingKey(user, routeModes)
        const current = (
            (await ctx.database.get('chatluna_binding', {
                bindingKey
            })) as BindingRecord[]
        )[0]

        // (#16) decomposed nested ternary into explicit variable
        const prevActive = current?.activeConversationId
        const lastConversationId =
            prevActive != null && prevActive !== conversation.id
                ? prevActive
                : (current?.lastConversationId ?? null)

        await ctx.database.upsert('chatluna_binding', [
            {
                bindingKey,
                activeConversationId: conversation.id,
                lastConversationId,
                updatedAt: new Date()
            }
        ])

        progress.migrated += 1
        // (#8) batch progress writes
        if (
            progress.migrated % BINDING_PROGRESS_BATCH === 0 ||
            i === users.length - 1
        ) {
            await writeMetaValue(ctx, 'binding_migration_progress', progress)
        }
    }
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
    // (#4) inlined addAclRecord — was a 4-line single-use wrapper
    const map = new Map<string, ACLRecord>()
    const add = (record: ACLRecord) =>
        map.set(
            aclKey(
                record.conversationId,
                record.principalType,
                record.principalId,
                record.permission
            ),
            record
        )

    for (const member of members) {
        add({
            conversationId,
            principalType: 'user',
            principalId: member.userId,
            permission: 'view'
        })

        if (
            member.roomPermission === 'owner' ||
            member.roomPermission === 'admin'
        ) {
            add({
                conversationId,
                principalType: 'user',
                principalId: member.userId,
                permission: 'manage'
            })
        }
    }

    for (const group of groups) {
        add({
            conversationId,
            principalType: 'guild',
            principalId: group.groupId,
            permission: 'view'
        })
    }

    if (room.roomMasterId.length > 0) {
        add({
            conversationId,
            principalType: 'user',
            principalId: room.roomMasterId,
            permission: 'manage'
        })
    }

    return Array.from(map.values())
}
