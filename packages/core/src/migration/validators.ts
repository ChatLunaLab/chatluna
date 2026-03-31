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
    LegacyConversationRecord,
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
export async function validateRoomMigration(ctx: Context, config: Config) {
    // All queries are independent — run in parallel (#20)
    const [
        rooms,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _,
        oldMessages,
        users,
        members,
        groups,
        conversations,
        messages,
        bindings,
        acl
    ] = (await Promise.all([
        ctx.database.get('chathub_room', {}),
        ctx.database.get('chathub_conversation', {}),
        ctx.database.get('chathub_message', {}),
        ctx.database.get('chathub_user', {}),
        ctx.database.get('chathub_room_member', {}),
        ctx.database.get('chathub_room_group_member', {}),
        ctx.database.get('chatluna_conversation', {}),
        ctx.database.get('chatluna_message', {}),
        ctx.database.get('chatluna_binding', {}),
        ctx.database.get('chatluna_acl', {})
    ])) as [
        LegacyRoomRecord[],
        LegacyConversationRecord[],
        LegacyMessageRecord[],
        LegacyUserRecord[],
        LegacyRoomMemberRecord[],
        LegacyRoomGroupRecord[],
        ConversationRecord[],
        MessageRecord[],
        BindingRecord[],
        ACLRecord[]
    ]

    const routeModes = inferLegacyGroupRouteModes(users, rooms, groups)

    // Shared filter logic (#21)
    const validRooms = filterValidRooms(rooms)
    const validConversationIds = new Set(
        validRooms.map((room) => room.conversationId as string)
    )
    const migratedLegacyConversations = conversations.filter(
        (item) => item.legacyRoomId != null || validConversationIds.has(item.id)
    )
    const migratedLegacyMessages = messages.filter(
        (item) => item.createdAt == null
    )
    const migratedMessageIds = new Set(messages.map((item) => item.id))
    const migratedBindingKeys = new Set(bindings.map((item) => item.bindingKey))
    const migratedAclKeys = new Set(
        acl.map((item) =>
            aclKey(
                item.conversationId,
                item.principalType,
                item.principalId,
                item.permission
            )
        )
    )

    const missingLatestMessageIds = migratedLegacyConversations
        .filter(
            (item) =>
                item.latestMessageId != null &&
                !migratedMessageIds.has(item.latestMessageId)
        )
        .map((item) => item.id)
    const inconsistentBindingConversationIds = validRooms
        .map((room) => {
            const roomMembers = members.filter(
                (item) => item.roomId === room.roomId
            )
            const roomGroups = groups.filter(
                (item) => item.roomId === room.roomId
            )
            const conversation = migratedLegacyConversations.find(
                (item) => item.id === room.conversationId
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
        const conversation = conversations.find(
            (item) => item.legacyRoomId === user.defaultRoomId
        )

        if (conversation == null) {
            // (#23) push the conversation id (derived from defaultRoomId match), not the raw roomId
            // When no conversation was migrated for this user's defaultRoomId, record it as missing.
            // We record String(user.defaultRoomId) as a sentinel since no conversationId exists yet.
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
            migrated: migratedLegacyConversations.length,
            matched:
                validConversationIds.size === migratedLegacyConversations.length
        },
        message: {
            legacy: oldMessages.length,
            migrated: migratedLegacyMessages.length,
            matched: oldMessages.length === migratedLegacyMessages.length
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
            migrated: acl.length,
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
