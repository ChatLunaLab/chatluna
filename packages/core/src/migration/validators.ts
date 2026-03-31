import type { Context } from 'koishi'
import type { Config } from '../config'
import type {
    ACLRecord,
    BindingRecord,
    ConversationRecord,
    MessageRecord,
    MetaRecord
} from '../services/conversation_types'
import type {
    LegacyMessageRecord,
    LegacyRoomGroupRecord,
    LegacyRoomMemberRecord,
    LegacyRoomRecord,
    LegacyUserRecord
} from '../services/types'
import type { MigrationValidationResult } from './types'
export type { MigrationValidationResult } from './types'
export {
    getLegacySchemaSentinelDir,
    getLegacySchemaSentinel,
    LEGACY_MIGRATION_TABLES,
    LEGACY_RETENTION_META_KEY,
    LEGACY_RUNTIME_TABLES,
    LEGACY_SCHEMA_SENTINEL,
    createLegacyTableRetention,
    purgeLegacyTables
} from './legacy_tables'

const VALIDATION_BATCH_SIZE = 500

export async function validateRoomMigration(ctx: Context, _config: Config) {
    const rooms = (await ctx.database.get(
        'chathub_room',
        {}
    )) as LegacyRoomRecord[]
    const users = (await ctx.database.get(
        'chathub_user',
        {}
    )) as LegacyUserRecord[]
    const members = (await ctx.database.get(
        'chathub_room_member',
        {}
    )) as LegacyRoomMemberRecord[]
    const groups = (await ctx.database.get(
        'chathub_room_group_member',
        {}
    )) as LegacyRoomGroupRecord[]

    const routeModes = inferLegacyGroupRouteModes(users, rooms, groups)

    const validRooms = filterValidRooms(rooms)
    const validConversationIds = new Set(
        validRooms.map((room) => room.conversationId as string)
    )

    let legacyMessageCount = 0
    await readTableBatches<LegacyMessageRecord>(
        ctx,
        'chathub_message',
        (rows) => {
            legacyMessageCount += rows.length
        }
    )

    let migratedLegacyMessageCount = 0
    await readTableBatches<MessageRecord>(ctx, 'chatluna_message', (rows) => {
        for (const row of rows) {
            if (row.createdAt == null) {
                migratedLegacyMessageCount += 1
            }
        }
    })

    const conversationsById = new Map<string, ConversationRecord>()
    const conversationsByRoomId = new Map<number, ConversationRecord>()
    const missingLatestMessageIds: string[] = []
    let migratedLegacyConversationCount = 0

    await readTableBatches<ConversationRecord>(
        ctx,
        'chatluna_conversation',
        async (rows) => {
            const checked = rows.filter(
                (row) =>
                    row.legacyRoomId != null || validConversationIds.has(row.id)
            )

            if (checked.length === 0) {
                return
            }

            migratedLegacyConversationCount += checked.length

            for (const row of checked) {
                conversationsById.set(row.id, row)
                if (row.legacyRoomId != null) {
                    conversationsByRoomId.set(row.legacyRoomId, row)
                }
            }

            const latestMessageIds = checked
                .map((row) => row.latestMessageId)
                .filter((id) => id != null)

            if (latestMessageIds.length === 0) {
                return
            }

            const existing = new Set(
                (
                    (await ctx.database.get('chatluna_message', {
                        id: { $in: latestMessageIds }
                    })) as MessageRecord[]
                ).map((row) => row.id)
            )

            for (const row of checked) {
                if (
                    row.latestMessageId != null &&
                    !existing.has(row.latestMessageId)
                ) {
                    missingLatestMessageIds.push(row.id)
                }
            }
        }
    )

    const migratedBindingKeys = new Set<string>()
    await readTableBatches<BindingRecord>(ctx, 'chatluna_binding', (rows) => {
        for (const row of rows) {
            migratedBindingKeys.add(row.bindingKey)
        }
    })

    const migratedAclKeys = new Set<string>()
    let migratedAclCount = 0
    await readTableBatches<ACLRecord>(ctx, 'chatluna_acl', (rows) => {
        migratedAclCount += rows.length
        for (const row of rows) {
            migratedAclKeys.add(
                aclKey(
                    row.conversationId,
                    row.principalType,
                    row.principalId,
                    row.permission
                )
            )
        }
    })

    const inconsistentBindingConversationIds = validRooms
        .map((room) => {
            const roomMembers = members.filter(
                (item) => item.roomId === room.roomId
            )
            const roomGroups = groups.filter(
                (item) => item.roomId === room.roomId
            )
            const conversation = conversationsById.get(
                room.conversationId as string
            )

            if (conversation == null) {
                return null
            }

            const bindingKey = resolveRoomBindingKey(
                room,
                roomMembers,
                roomGroups,
                routeModes
            )

            return conversation.bindingKey === bindingKey
                ? null
                : conversation.id
        })
        .filter((id) => id != null) as string[] // (#22)

    const missingBindingKeys: string[] = []
    const missingBindingConversationIds: string[] = []

    for (const user of users) {
        const conversation = conversationsByRoomId.get(user.defaultRoomId)

        if (conversation == null) {
            missingBindingConversationIds.push(String(user.defaultRoomId))
            continue
        }

        const bindingKey = createLegacyBindingKey(user, routeModes)
        if (!migratedBindingKeys.has(bindingKey)) {
            missingBindingKeys.push(bindingKey)
        }
    }

    const expectedAclKeys: string[] = []

    for (const room of validRooms) {
        const roomMembers = members.filter(
            (item) => item.roomId === room.roomId
        )
        const roomGroups = groups.filter((item) => item.roomId === room.roomId)

        if (!isComplexRoom(room, roomMembers, roomGroups)) {
            continue
        }

        const conversationId = room.conversationId as string

        for (const member of roomMembers) {
            expectedAclKeys.push(
                aclKey(conversationId, 'user', member.userId, 'view')
            )

            if (
                member.roomPermission === 'owner' ||
                member.roomPermission === 'admin'
            ) {
                expectedAclKeys.push(
                    aclKey(conversationId, 'user', member.userId, 'manage')
                )
            }
        }

        for (const group of roomGroups) {
            expectedAclKeys.push(
                aclKey(conversationId, 'guild', group.groupId, 'view')
            )
        }

        if (room.roomMasterId.length > 0) {
            expectedAclKeys.push(
                aclKey(conversationId, 'user', room.roomMasterId, 'manage')
            )
        }
    }

    const missingAclKeys = expectedAclKeys.filter(
        (key) => !migratedAclKeys.has(key)
    )

    // (#28) derive `passed` from the sub-result fields rather than repeating conditions
    const result = {
        checkedAt: new Date().toISOString(),
        conversation: {
            legacy: validConversationIds.size,
            migrated: migratedLegacyConversationCount,
            matched:
                validConversationIds.size === migratedLegacyConversationCount
        },
        message: {
            legacy: legacyMessageCount,
            migrated: migratedLegacyMessageCount,
            matched: legacyMessageCount === migratedLegacyMessageCount
        },
        latestMessageId: {
            missingConversationIds: missingLatestMessageIds,
            matched: missingLatestMessageIds.length === 0
        },
        bindingKey: {
            inconsistentConversationIds: inconsistentBindingConversationIds,
            matched: inconsistentBindingConversationIds.length === 0
        },
        binding: {
            missingBindingKeys,
            missingConversationIds: missingBindingConversationIds,
            matched:
                missingBindingKeys.length === 0 &&
                missingBindingConversationIds.length === 0
        },
        acl: {
            expected: expectedAclKeys.length,
            migrated: migratedAclCount,
            missing: missingAclKeys,
            matched: missingAclKeys.length === 0
        }
    }

    return {
        ...result,
        passed:
            result.conversation.matched &&
            result.message.matched &&
            result.latestMessageId.matched &&
            result.bindingKey.matched &&
            result.binding.matched &&
            result.acl.matched
    } satisfies MigrationValidationResult
}

async function readTableBatches<T>(
    ctx: Context,
    table:
        | 'chathub_message'
        | 'chatluna_message'
        | 'chatluna_conversation'
        | 'chatluna_binding'
        | 'chatluna_acl',
    callback: (rows: T[]) => Promise<void> | void
) {
    let offset = 0

    while (true) {
        const rows = (await ctx.database.get(
            table,
            {},
            {
                offset,
                limit: VALIDATION_BATCH_SIZE
            }
        )) as T[]

        if (rows.length === 0) {
            return
        }

        await callback(rows)
        offset += rows.length
    }
}

export async function readMetaValue<T>(ctx: Context, key: string) {
    const row = (
        (await ctx.database.get('chatluna_meta', {
            key
        })) as MetaRecord[]
    )[0]

    // (#27) remove spurious value === '' check; writeMetaValue stores SQL NULL for null, never ''
    if (row?.value == null) {
        return undefined as T | undefined
    }

    return JSON.parse(row.value) as T
}

export async function writeMetaValue(
    ctx: Context,
    key: string,
    value: unknown
) {
    await ctx.database.upsert('chatluna_meta', [
        {
            key,
            value: value == null ? null : JSON.stringify(value),
            updatedAt: new Date()
        }
    ])
}

export function createLegacyBindingKey(
    user: LegacyUserRecord,
    routeModes: Map<string, 'shared' | 'personal'> // (#26) removed dead union branch; callers always pass Map
) {
    if (user.groupId == null || user.groupId === '' || user.groupId === '0') {
        return `personal:legacy:legacy:direct:${user.userId}`
    }

    if ((routeModes.get(user.groupId) ?? 'personal') === 'shared') {
        return `shared:legacy:legacy:${user.groupId}`
    }

    return `personal:legacy:legacy:${user.groupId}:${user.userId}`
}

export function isComplexRoom(
    room: LegacyRoomRecord,
    members: LegacyRoomMemberRecord[],
    groups: LegacyRoomGroupRecord[]
) {
    return (
        members.length > 2 ||
        groups.length > 1 ||
        (room.password != null && room.password.length > 0)
    )
}

// (#21) shared filter extracted from both validateRoomMigration and migrateRooms
export function filterValidRooms(rooms: LegacyRoomRecord[]) {
    return rooms.filter(
        (room) =>
            room.conversationId != null &&
            room.conversationId !== '' &&
            room.conversationId !== '0'
    )
}

// (#18) shared ACL key format used in both migration and validation
export function aclKey(
    conversationId: string,
    principalType: string,
    principalId: string,
    permission: string
) {
    return `${conversationId}:${principalType}:${principalId}:${permission}`
}

// (#5, #29) unified binding key resolver — replaces the duplicated resolveRoomBindingKey
// in room_to_conversation.ts and resolveConversationBindingKey in validators.ts
export function resolveRoomBindingKey(
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

export function inferLegacyGroupRouteModes(
    users: LegacyUserRecord[],
    rooms: LegacyRoomRecord[],
    groups: LegacyRoomGroupRecord[]
) {
    const modes = new Map<string, 'shared' | 'personal'>()
    const publicGroups = new Set<string>()
    // (#24) firstRoomId replaces the separate roomIds Map — stores the roomId seen
    // the first time a group is set to 'shared' via the optimistic heuristic (#25).
    // Heuristic: if all private-room users in a group share the same roomId, it's
    // treated as shared; if a second user has a different roomId, we switch to personal.
    const firstRoomId = new Map<string, number>()

    for (const group of groups) {
        if (
            group.roomVisibility === 'public' ||
            group.roomVisibility === 'template_clone'
        ) {
            publicGroups.add(group.groupId)
            modes.set(group.groupId, 'shared')
        }
    }

    for (const user of users) {
        if (
            user.groupId == null ||
            user.groupId === '' ||
            user.groupId === '0'
        ) {
            continue
        }

        if (publicGroups.has(user.groupId)) {
            continue
        }

        const room = rooms.find((item) => item.roomId === user.defaultRoomId)
        if (room == null) {
            continue
        }

        if (
            room.visibility === 'public' ||
            room.visibility === 'template_clone'
        ) {
            modes.set(user.groupId, 'shared')
            continue
        }

        const previous = modes.get(user.groupId)
        if (previous == null) {
            firstRoomId.set(user.groupId, room.roomId)
            modes.set(user.groupId, 'shared')
            continue
        }

        if (
            previous === 'shared' &&
            firstRoomId.get(user.groupId) !== room.roomId
        ) {
            modes.set(user.groupId, 'personal')
        }
    }

    return modes
}
