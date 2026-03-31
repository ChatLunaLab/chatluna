import path from 'path'
import fs from 'fs/promises'
import type { Context } from 'koishi'
import type { LegacyTableRetention } from './types'
export type { LegacyTableRetention } from './types'

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

export async function purgeLegacyTables(ctx: Context) {
    for (const table of [
        ...LEGACY_MIGRATION_TABLES,
        ...LEGACY_RUNTIME_TABLES
    ]) {
        try {
            await ctx.database.drop(table)
        } catch (error) {
            ctx.logger.warn(`purge legacy ${table}: ${error}`)
        }
    }

    const sentinel = getLegacySchemaSentinel(ctx.baseDir)
    await fs.mkdir(getLegacySchemaSentinelDir(ctx.baseDir), { recursive: true })
    await fs.writeFile(
        sentinel,
        JSON.stringify({ purgedAt: new Date().toISOString() })
    )
}
