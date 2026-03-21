import path from 'path'

export const LEGACY_SCHEMA_SENTINEL =
    'data/chatluna/temp/legacy-schema-disabled.json'

export const LEGACY_MIGRATION_TABLES = [
    'chathub_room_member',
    'chathub_room_group_member',
    'chathub_user',
    'chathub_room',
    'chathub_message',
    'chathub_conversation'
] as const

export const LEGACY_RUNTIME_TABLES = [
    'chathub_auth_group',
    'chathub_auth_joined_user',
    'chathub_auth_user'
] as const

export const LEGACY_RETENTION_META_KEY = 'legacy_table_retention'

export interface LegacyTableRetention {
    state: 'migration-visible' | 'purged'
    migrationTables: readonly string[]
    runtimeTables: readonly string[]
}

export function createLegacyTableRetention(
    state: LegacyTableRetention['state']
) {
    return {
        state,
        migrationTables: [...LEGACY_MIGRATION_TABLES],
        runtimeTables: [...LEGACY_RUNTIME_TABLES]
    } satisfies LegacyTableRetention
}

export function getLegacySchemaSentinel(baseDir: string) {
    return path.resolve(baseDir, LEGACY_SCHEMA_SENTINEL)
}

export function getLegacySchemaSentinelDir(baseDir: string) {
    return path.dirname(getLegacySchemaSentinel(baseDir))
}
