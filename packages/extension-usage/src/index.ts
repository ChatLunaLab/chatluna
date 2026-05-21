import { Context, Schema } from 'koishi'
import type { ModelUsageCallType } from 'koishi-plugin-chatluna/llm-core/platform/usage'

export interface UsageRecord {
    id?: number
    source: string
    callType: ModelUsageCallType
    platform: string
    model: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    estimated: boolean
    createdAt: Date
    conversationId?: string | null
    requestId?: string | null
    userId?: string | null
    guildId?: string | null
}

export interface UsageSummaryRow {
    source: string
    calls: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    estimatedTokens: number
}

export function apply(ctx: Context) {
    ctx.database.extend(
        'chatluna_usage',
        {
            id: 'unsigned',
            source: { type: 'char', length: 128 },
            callType: { type: 'char', length: 20 },
            platform: { type: 'char', length: 128 },
            model: { type: 'char', length: 255 },
            inputTokens: 'unsigned',
            outputTokens: 'unsigned',
            totalTokens: 'unsigned',
            estimated: 'boolean',
            createdAt: { type: 'timestamp', nullable: false },
            conversationId: { type: 'char', length: 255, nullable: true },
            requestId: { type: 'char', length: 255, nullable: true },
            userId: { type: 'char', length: 255, nullable: true },
            guildId: { type: 'char', length: 255, nullable: true }
        },
        {
            autoInc: true,
            primary: 'id',
            indexes: ['createdAt', 'source']
        }
    )

    ctx.on('chatluna/model-usage', async (usage) => {
        await ctx.database.create('chatluna_usage', {
            ...usage,
            conversationId: usage.conversationId ?? null,
            requestId: usage.requestId ?? null,
            userId: usage.userId ?? null,
            guildId: usage.guildId ?? null
        })
    })
}

export async function queryUsage(ctx: Context, source?: string) {
    const rows = (await ctx.database.get(
        'chatluna_usage',
        source ? { source } : {}
    )) as UsageRecord[]
    const groups = new Map<string, UsageSummaryRow>()

    for (const row of rows) {
        const item = groups.get(row.source) ?? {
            source: row.source,
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedTokens: 0
        }
        item.calls += 1
        item.inputTokens += row.inputTokens
        item.outputTokens += row.outputTokens
        item.totalTokens += row.totalTokens
        if (row.estimated) item.estimatedTokens += row.totalTokens
        groups.set(row.source, item)
    }

    return [...groups.values()].sort(
        (left, right) => right.totalTokens - left.totalTokens
    )
}

export async function cleanupUsage(ctx: Context, before?: Date) {
    await ctx.database.remove(
        'chatluna_usage',
        before ? { createdAt: { $lt: before } } : {}
    )
}

declare module 'koishi' {
    interface Tables {
        chatluna_usage: UsageRecord
    }
}

export type Config = object

export const Config: Schema<Config> = Schema.object({})

export const inject = {
    required: ['chatluna', 'database']
}

export const name = 'chatluna-usage'
