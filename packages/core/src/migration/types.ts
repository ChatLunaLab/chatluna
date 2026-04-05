export interface LegacyTableRetention {
    state: 'migration-visible' | 'purged'
    migrationTables: readonly string[]
    runtimeTables: readonly string[]
}

export interface RoomProgress {
    lastRoomId: number
    migrated: number
}

export interface MessageProgress {
    index: number
    lastId?: string
    migrated: number
}

export interface BindingProgress {
    index: number
    migrated: number
}

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
