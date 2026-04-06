import { existsSync } from 'fs'
import { createHash, randomUUID } from 'crypto'
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
    defineLegacyMigrationTables,
    isMissingTableError,
    LEGACY_MIGRATION_TABLES
} from './legacy_tables'
import type { BindingProgress, MessageProgress, RoomProgress } from './types'
import {
    aclKey,
    createLegacyBindingKey,
    createLegacyTableRetention,
    createPassedValidationResult,
    filterValidRooms,
    getLegacySchemaSentinel,
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
    const hasSentinel = existsSync(getLegacySchemaSentinel(ctx.baseDir))

    if (hasSentinel && !(await hasLegacyMigrationData(ctx))) {
        return ensureMigrationValidated(ctx, config)
    }

    defineLegacyMigrationTables(ctx, hasSentinel)

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
        !hasSentinel &&
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

    // Mark completion before purge so a restart after writing the sentinel
    // can resume from the finished state instead of re-reading legacy tables.
    await writeMigrationDone(ctx)
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
    const hasSentinel = existsSync(getLegacySchemaSentinel(ctx.baseDir))
    const hasLegacyData = hasSentinel
        ? await hasLegacyMigrationData(ctx)
        : false

    if (hasSentinel && hasLegacyData) {
        ctx.logger.warn(
            'Legacy sentinel exists but legacy ChatHub data is still present; continuing migration from legacy tables.'
        )
        defineLegacyMigrationTables(ctx, true)
    }

    const result = await readMetaValue<
        Awaited<ReturnType<typeof validateRoomMigration>>
    >(ctx, 'validation_result')
    const retention = await readMetaValue<{
        state?: string
    }>(ctx, LEGACY_RETENTION_META_KEY)

    if (hasSentinel) {
        if (hasLegacyData) {
            return runRoomToConversationMigration(ctx, config)
        }

        if (result?.passed === true) {
            await writeMetaValue(ctx, 'schema_version', BUILTIN_SCHEMA_VERSION)
            await writeMigrationDone(ctx)
            await writeMigrationFinished(ctx)
            return result
        }

        const conversations = (await ctx.database.get(
            'chatluna_conversation',
            {},
            {
                limit: 1
            }
        )) as ConversationRecord[]
        const messages = (await ctx.database.get(
            'chatluna_message',
            {},
            {
                limit: 1
            }
        )) as MessageRecord[]
        const bindings = (await ctx.database.get(
            'chatluna_binding',
            {},
            {
                limit: 1
            }
        )) as BindingRecord[]
        const acl = (await ctx.database.get(
            'chatluna_acl',
            {},
            {
                limit: 1
            }
        )) as ACLRecord[]
        const hasData =
            conversations.length > 0 ||
            messages.length > 0 ||
            bindings.length > 0 ||
            acl.length > 0

        ctx.logger.warn(
            hasData
                ? 'Legacy sentinel exists and ChatLuna data is present; adopting current ChatLuna state and marking migration finished.'
                : 'Legacy sentinel exists and ChatLuna data is empty; treating startup as fresh install.'
        )

        const validated = createPassedValidationResult()
        await writeMetaValue(ctx, 'schema_version', BUILTIN_SCHEMA_VERSION)
        await writeMetaValue(ctx, 'validation_result', validated)
        await writeMigrationDone(ctx)
        await writeMigrationFinished(ctx)
        return validated
    }

    if (result?.passed === true) {
        await writeMetaValue(ctx, 'schema_version', BUILTIN_SCHEMA_VERSION)
        await writeMigrationDone(ctx)

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

    if (retention?.state !== 'purged') {
        defineLegacyMigrationTables(ctx)
    }

    const validated = await validateRoomMigration(ctx, config)
    await writeMetaValue(ctx, 'validation_result', validated)

    if (!validated.passed) {
        throw new Error('ChatLuna migration validation failed.')
    }

    await writeMigrationDone(ctx)
    await purgeLegacyTables(ctx)
    await writeMigrationFinished(ctx)

    return validated
}

async function writeMigrationDone(ctx: Context) {
    await writeMetaValue(ctx, 'room_migration_done', true)
    await writeMetaValue(ctx, 'message_migration_done', true)
}

async function writeMigrationFinished(ctx: Context) {
    await writeMetaValue(
        ctx,
        LEGACY_RETENTION_META_KEY,
        createLegacyTableRetention('purged')
    )
    await writeMetaValue(ctx, 'migration_finished_at', new Date().toISOString())
}

async function hasLegacyMigrationData(ctx: Context) {
    defineLegacyMigrationTables(ctx, true)

    for (const table of LEGACY_MIGRATION_TABLES) {
        try {
            if (
                (
                    await ctx.database.get(
                        table as never,
                        {},
                        {
                            limit: 1
                        }
                    )
                ).length > 0
            ) {
                return true
            }
        } catch (error) {
            if (!isMissingTableError(error)) {
                throw error
            }
        }
    }

    return false
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
    const usedConversationIds = new Set(existing.map((item) => item.id))
    // (#10) only count records that were actually migrated from legacy rooms
    const progress = (await readMetaValue<RoomProgress>(
        ctx,
        'conversation_migration_progress'
    )) ?? {
        lastRoomId: 0,
        migrated: existing.filter((item) => item.legacyRoomId != null).length
    }

    ctx.logger.info(
        `Migrating conversations: ${progress.migrated}/${rooms.length}`
    )

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
        const legacyConversationId = room.conversationId as string
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

        const conversationId =
            current?.id ??
            (usedConversationIds.has(legacyConversationId)
                ? randomUUID()
                : legacyConversationId)
        usedConversationIds.add(conversationId)

        const conversation: ConversationRecord = {
            id: conversationId,
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
            latestMessageId: mapMessageId(
                legacyConversationId,
                conversationId,
                oldConversation?.latestId ?? null
            ),
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

        const acl = buildAclRecords(
            conversation.id,
            room,
            roomMembers,
            roomGroups
        )
        if (acl.length > 0) {
            await ctx.database.upsert('chatluna_acl', acl)
        }

        progress.lastRoomId = room.roomId
        progress.migrated += 1
        await writeMetaValue(ctx, 'conversation_migration_progress', progress)

        if (
            progress.migrated % BINDING_PROGRESS_BATCH === 0 ||
            room.roomId === rooms[rooms.length - 1]?.roomId
        ) {
            ctx.logger.info(
                `Migrating conversations: ${progress.migrated}/${rooms.length}`
            )
        }
    }

    ctx.logger.info(
        `Conversation migration done: ${progress.migrated}/${rooms.length}`
    )
}

// (#7) removed redundant inner `done` check
async function migrateMessages(ctx: Context) {
    const rooms = filterValidRooms(
        (await ctx.database.get('chathub_room', {})) as LegacyRoomRecord[]
    )
    const conversations = (await ctx.database.get(
        'chatluna_conversation',
        {}
    )) as ConversationRecord[]
    const targets = createConversationTargets(rooms, conversations)
    const progress = (await readMetaValue<MessageProgress>(
        ctx,
        'message_migration_progress'
    )) ?? {
        index: 0,
        migrated: 0
    }

    ctx.logger.info(
        `Migrating messages: scanned ${progress.index}, written ${progress.migrated}`
    )

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

        const payload: MessageRecord[] = batch.flatMap((item) => {
            const conversationIds = targets.get(item.conversation)

            if (conversationIds == null) {
                return []
            }

            return conversationIds.map((conversationId) => ({
                id: mapMessageId(item.conversation, conversationId, item.id)!,
                conversationId,
                parentId: mapMessageId(
                    item.conversation,
                    conversationId,
                    item.parent ?? null
                ),
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
            }))
        })

        if (payload.length > 0) {
            await ctx.database.upsert('chatluna_message', payload)
        }

        progress.index += batch.length
        progress.lastId = batch[batch.length - 1]?.id
        progress.migrated += payload.length
        await writeMetaValue(ctx, 'message_migration_progress', progress)
        ctx.logger.info(
            `Migrating messages: scanned ${progress.index}, written ${progress.migrated}`
        )
    }

    ctx.logger.info(
        `Message migration done: scanned ${progress.index}, written ${progress.migrated}`
    )
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

    ctx.logger.info(
        `Migrating bindings: processed ${progress.index}/${users.length}, migrated ${progress.migrated}`
    )

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
                ctx.logger.info(
                    `Migrating bindings: processed ${progress.index}/${users.length}, migrated ${progress.migrated}`
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
            ctx.logger.info(
                `Migrating bindings: processed ${progress.index}/${users.length}, migrated ${progress.migrated}`
            )
        }
    }

    ctx.logger.info(
        `Binding migration done: processed ${progress.index}/${users.length}, migrated ${progress.migrated}`
    )
}

function createConversationTargets(
    rooms: LegacyRoomRecord[],
    conversations: ConversationRecord[]
) {
    const conversationsByRoomId = new Map(
        conversations
            .filter((item) => item.legacyRoomId != null)
            .map((item) => [item.legacyRoomId!, item])
    )
    const targets = new Map<string, string[]>()

    for (const room of rooms) {
        const conversation = conversationsByRoomId.get(room.roomId)

        if (conversation == null) {
            continue
        }

        const legacyConversationId = room.conversationId as string
        const ids = targets.get(legacyConversationId)

        if (ids == null) {
            targets.set(legacyConversationId, [conversation.id])
            continue
        }

        if (!ids.includes(conversation.id)) {
            ids.push(conversation.id)
        }
    }

    return targets
}

function mapMessageId(
    legacyConversationId: string,
    conversationId: string,
    messageId?: string | null
) {
    if (messageId == null) {
        return null
    }

    if (conversationId === legacyConversationId) {
        return messageId
    }

    return createHash('sha256')
        .update(conversationId + ':' + messageId)
        .digest('hex')
}

function buildAclRecords(
    conversationId: string,
    room: LegacyRoomRecord,
    members: LegacyRoomMemberRecord[],
    groups: LegacyRoomGroupRecord[]
) {
    if (!isComplexRoom(room, members, groups)) {
        return []
    }

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
