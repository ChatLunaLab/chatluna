import type { Context } from 'koishi'
import type { Config } from '../config'
export {
    getLegacySchemaSentinelDir,
    getLegacySchemaSentinel,
    LEGACY_MIGRATION_TABLES,
    LEGACY_RETENTION_META_KEY,
    LEGACY_RUNTIME_TABLES,
    LEGACY_SCHEMA_SENTINEL,
    createLegacyTableRetention
} from './legacy_tables'
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
export interface MigrationValidationResult {
    passed: boolean
    checkedAt: string
    conversation: {
        legacy: number
        migrated: number
        matched: boolean
    }
    message: {
        legacy: number
        migrated: number
        matched: boolean
    }
    latestMessageId: {
        missingConversationIds: string[]
        matched: boolean
    }
    bindingKey: {
        inconsistentConversationIds: string[]
        matched: boolean
    }
    binding: {
        missingBindingKeys: string[]
        missingConversationIds: string[]
        matched: boolean
    }
    acl: {
        expected: number
        migrated: number
        missing: string[]
        matched: boolean
    }
}

export async function validateRoomMigration(ctx: Context, config: Config) {
    const rooms = (await ctx.database.get(
        'chathub_room',
        {}
    )) as LegacyRoomRecord[]
    const oldConversations = (await ctx.database.get(
        'chathub_conversation',
        {}
    )) as LegacyConversationRecord[]
    const oldMessages = (await ctx.database.get(
        'chathub_message',
        {}
    )) as LegacyMessageRecord[]
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
    const conversations = (await ctx.database.get(
        'chatluna_conversation',
        {}
    )) as ConversationRecord[]
    const messages = (await ctx.database.get(
        'chatluna_message',
        {}
    )) as MessageRecord[]
    const bindings = (await ctx.database.get(
        'chatluna_binding',
        {}
    )) as BindingRecord[]
    const acl = (await ctx.database.get('chatluna_acl', {})) as ACLRecord[]

    const validRooms = rooms.filter(
        (room) =>
            room.conversationId != null &&
            room.conversationId !== '' &&
            room.conversationId !== '0'
    )
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
        acl.map(
            (item) =>
                `${item.conversationId}:${item.principalType}:${item.principalId}:${item.permission}`
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

            const bindingKey = resolveConversationBindingKey(
                room,
                roomMembers,
                roomGroups,
                routeModes
            )

            return conversation.bindingKey === bindingKey
                ? null
                : conversation.id
        })
        .filter((id) => id != null)

    const missingBindingKeys: string[] = []
    const missingBindingConversationIds: string[] = []

    for (const user of users) {
        const conversation = conversations.find(
            (item) => item.legacyRoomId === user.defaultRoomId
        )

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
            expectedAclKeys.push(`${conversationId}:user:${member.userId}:view`)

            if (
                member.roomPermission === 'owner' ||
                member.roomPermission === 'admin'
            ) {
                expectedAclKeys.push(
                    `${conversationId}:user:${member.userId}:manage`
                )
            }
        }

        for (const group of roomGroups) {
            expectedAclKeys.push(
                `${conversationId}:guild:${group.groupId}:view`
            )
        }

        if (room.roomMasterId.length > 0) {
            expectedAclKeys.push(
                `${conversationId}:user:${room.roomMasterId}:manage`
            )
        }
    }

    const missingAclKeys = expectedAclKeys.filter(
        (key) => !migratedAclKeys.has(key)
    )

    return {
        passed:
            validConversationIds.size === migratedLegacyConversations.length &&
            oldMessages.length === migratedLegacyMessages.length &&
            missingLatestMessageIds.length === 0 &&
            inconsistentBindingConversationIds.length === 0 &&
            missingBindingKeys.length === 0 &&
            missingBindingConversationIds.length === 0 &&
            missingAclKeys.length === 0,
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
    } satisfies MigrationValidationResult
}

export async function readMetaValue<T>(ctx: Context, key: string) {
    const row = (
        (await ctx.database.get('chatluna_meta', {
            key
        })) as MetaRecord[]
    )[0]

    if (row?.value == null || row.value === '') {
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
    routeModes: 'shared' | 'personal' | Map<string, 'shared' | 'personal'>
) {
    if (user.groupId == null || user.groupId === '' || user.groupId === '0') {
        return `personal:legacy:legacy:direct:${user.userId}`
    }

    const routeMode =
        routeModes instanceof Map
            ? (routeModes.get(user.groupId) ?? 'personal')
            : routeModes

    if (routeMode === 'shared') {
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

export function inferLegacyGroupRouteModes(
    users: LegacyUserRecord[],
    rooms: LegacyRoomRecord[],
    groups: LegacyRoomGroupRecord[]
) {
    const modes = new Map<string, 'shared' | 'personal'>()
    const publicGroups = new Set<string>()
    const roomIds = new Map<string, number>()

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
            roomIds.set(user.groupId, room.roomId)
            modes.set(user.groupId, 'shared')
            continue
        }

        if (
            previous === 'shared' &&
            roomIds.get(user.groupId) !== room.roomId
        ) {
            modes.set(user.groupId, 'personal')
        }
    }

    return modes
}

function resolveConversationBindingKey(
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
