import { existsSync } from 'fs'
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

export const LEGACY_RUNTIME_TABLES = [] as const

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

export function defineLegacyMigrationTables(ctx: Context) {
    if (existsSync(getLegacySchemaSentinel(ctx.baseDir))) {
        return
    }

    ctx.database.extend(
        'chathub_conversation',
        {
            id: {
                type: 'char',
                length: 255
            },
            latestId: {
                type: 'char',
                length: 255,
                nullable: true
            },
            additional_kwargs: {
                type: 'text',
                nullable: true
            },
            updatedAt: {
                type: 'timestamp',
                nullable: false,
                initial: new Date()
            }
        },
        {
            autoInc: false,
            primary: 'id',
            unique: ['id']
        }
    )

    ctx.database.extend(
        'chathub_message',
        {
            id: {
                type: 'char',
                length: 255
            },
            text: {
                type: 'text',
                nullable: true
            },
            content: {
                type: 'binary',
                nullable: true
            },
            parent: {
                type: 'char',
                length: 255,
                nullable: true
            },
            role: {
                type: 'char',
                length: 20
            },
            conversation: {
                type: 'char',
                length: 255
            },
            additional_kwargs: {
                type: 'text',
                nullable: true
            },
            additional_kwargs_binary: {
                type: 'binary',
                nullable: true
            },
            tool_call_id: 'string',
            tool_calls: {
                type: 'json',
                nullable: true
            },
            name: {
                type: 'char',
                length: 255,
                nullable: true
            },
            rawId: {
                type: 'char',
                length: 255,
                nullable: true
            }
        },
        {
            autoInc: false,
            primary: 'id',
            unique: ['id']
        }
    )

    ctx.database.extend(
        'chathub_room',
        {
            roomId: {
                type: 'integer'
            },
            roomName: 'string',
            conversationId: {
                type: 'char',
                length: 255,
                nullable: true
            },
            roomMasterId: {
                type: 'char',
                length: 255
            },
            visibility: {
                type: 'char',
                length: 20
            },
            preset: {
                type: 'char',
                length: 255
            },
            model: {
                type: 'char',
                length: 100
            },
            chatMode: {
                type: 'char',
                length: 20
            },
            password: {
                type: 'char',
                length: 100,
                nullable: true
            },
            autoUpdate: {
                type: 'boolean',
                initial: false
            },
            updatedTime: {
                type: 'timestamp',
                nullable: false,
                initial: new Date()
            }
        },
        {
            autoInc: false,
            primary: 'roomId',
            unique: ['roomId']
        }
    )

    ctx.database.extend(
        'chathub_room_member',
        {
            userId: {
                type: 'string',
                length: 255
            },
            roomId: {
                type: 'integer'
            },
            roomPermission: {
                type: 'char',
                length: 50
            },
            mute: {
                type: 'boolean',
                initial: false
            }
        },
        {
            autoInc: false,
            primary: ['userId', 'roomId']
        }
    )

    ctx.database.extend(
        'chathub_room_group_member',
        {
            groupId: {
                type: 'char',
                length: 255
            },
            roomId: {
                type: 'integer'
            },
            roomVisibility: {
                type: 'char',
                length: 20
            }
        },
        {
            autoInc: false,
            primary: ['groupId', 'roomId']
        }
    )

    ctx.database.extend(
        'chathub_user',
        {
            userId: {
                type: 'char',
                length: 255
            },
            defaultRoomId: {
                type: 'integer'
            },
            groupId: {
                type: 'char',
                length: 255,
                nullable: true
            }
        },
        {
            autoInc: false,
            primary: ['userId', 'groupId']
        }
    )
}

function isMissingTableError(error: unknown) {
    const message = String(error).toLowerCase()
    return (
        message.includes('cannot resolve table') ||
        message.includes('no such table') ||
        message.includes('unknown table') ||
        message.includes('not found') ||
        message.includes("doesn't exist") ||
        message.includes('does not exist')
    )
}

export async function dropTableIfExists(ctx: Context, table: string) {
    try {
        await ctx.database.drop(table as never)
        return true
    } catch (error) {
        if (!isMissingTableError(error)) {
            throw error
        }

        ctx.logger.warn(`drop ${table}: ${error}`)
        return false
    }
}

export async function purgeLegacyTables(ctx: Context) {
    const failed: string[] = []

    for (const table of [
        ...LEGACY_MIGRATION_TABLES,
        ...LEGACY_RUNTIME_TABLES
    ]) {
        try {
            await dropTableIfExists(ctx, table)
        } catch (error) {
            ctx.logger.warn(`purge legacy ${table}: ${error}`)
            failed.push(table)
        }
    }

    if (failed.length > 0) {
        throw new Error(`Failed to purge legacy tables: ${failed.join(', ')}`)
    }

    const sentinel = getLegacySchemaSentinel(ctx.baseDir)
    await fs.mkdir(getLegacySchemaSentinelDir(ctx.baseDir), { recursive: true })
    await fs.writeFile(
        sentinel,
        JSON.stringify({ purgedAt: new Date().toISOString() })
    )
}
