import { Context, Schema } from 'koishi'
import type {
    ModelUsageCallType,
    ModelUsagePayload
} from 'koishi-plugin-chatluna/services/usage'

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

export interface UsageQuery {
    from?: string
    to?: string
    groupBy?: 'source' | 'model'
}

export type UsageCleanupInput =
    | {
          mode: 'all'
      }
    | {
          mode: 'beforeDays'
          days: number
      }

export interface UsageCleanupResult {
    mode: UsageCleanupInput['mode']
    cutoff?: string
}

export interface UsageSummaryRow {
    source: string
    platform?: string
    model?: string
    calls: number
    llmCalls: number
    embeddingsCalls: number
    rerankerCalls: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    estimatedTokens: number
    estimatedRatio: number
}

export interface UsageQueryResult {
    rows: UsageSummaryRow[]
    total: UsageSummaryRow
    from?: string
    to?: string
    groupBy: NonNullable<UsageQuery['groupBy']>
}

export function apply(ctx: Context) {
    defineDatabase(ctx)

    ctx.on('chatluna/model-usage', async (payload) => {
        await ctx.database.create('chatluna_usage', toRecord(payload))
    })
}

function defineDatabase(ctx: Context) {
    ctx.database.extend(
        'chatluna_usage',
        {
            id: 'unsigned',
            source: {
                type: 'char',
                length: 128
            },
            callType: {
                type: 'char',
                length: 20
            },
            platform: {
                type: 'char',
                length: 128
            },
            model: {
                type: 'char',
                length: 255
            },
            inputTokens: 'unsigned',
            outputTokens: 'unsigned',
            totalTokens: 'unsigned',
            estimated: 'boolean',
            createdAt: {
                type: 'timestamp',
                nullable: false,
                initial: new Date()
            },
            conversationId: {
                type: 'char',
                length: 255,
                nullable: true
            },
            requestId: {
                type: 'char',
                length: 255,
                nullable: true
            },
            userId: {
                type: 'char',
                length: 255,
                nullable: true
            },
            guildId: {
                type: 'char',
                length: 255,
                nullable: true
            }
        },
        {
            autoInc: true,
            primary: 'id',
            indexes: ['createdAt', 'source']
        }
    )
}

function toRecord(payload: ModelUsagePayload): UsageRecord {
    return {
        source: payload.source,
        callType: payload.callType,
        platform: payload.platform,
        model: payload.model,
        inputTokens: payload.inputTokens,
        outputTokens: payload.outputTokens,
        totalTokens: payload.totalTokens,
        estimated: payload.estimated,
        createdAt: payload.createdAt,
        conversationId: payload.conversationId ?? null,
        requestId: payload.requestId ?? null,
        userId: payload.userId ?? null,
        guildId: payload.guildId ?? null
    }
}

export function buildUsageWhere(query: UsageQuery) {
    const from = query.from ? new Date(query.from) : undefined
    const to = query.to ? new Date(query.to) : undefined

    if (from == null && to == null) {
        return {}
    }

    const range: { $gte?: Date; $lte?: Date } = {}
    if (from != null) range.$gte = from
    if (to != null) range.$lte = to

    return { createdAt: range }
}

export function buildCleanupWhere(input: UsageCleanupInput, now = new Date()) {
    if (input.mode === 'all') {
        return {}
    }

    if (
        !Number.isInteger(input.days) ||
        input.days <= 0 ||
        !Number.isFinite(input.days)
    ) {
        throw new Error('days must be a positive integer')
    }

    return {
        createdAt: {
            $lt: new Date(now.getTime() - input.days * 24 * 60 * 60 * 1000)
        }
    }
}

export async function queryUsage(ctx: Context, query: UsageQuery = {}) {
    const rows = (await ctx.database.get(
        'chatluna_usage',
        buildUsageWhere(query)
    )) as UsageRecord[]
    const groupBy = query.groupBy ?? 'source'

    return {
        rows: aggregateUsage(rows, undefined, groupBy),
        total: aggregateUsage(rows, 'Total')[0],
        from: query.from,
        to: query.to,
        groupBy
    } satisfies UsageQueryResult
}

export async function cleanupUsage(
    ctx: Context,
    input: UsageCleanupInput
): Promise<UsageCleanupResult> {
    const where = buildCleanupWhere(input)
    await ctx.database.remove('chatluna_usage', where)

    if (input.mode === 'all') {
        return { mode: input.mode }
    }

    return {
        mode: input.mode,
        cutoff: (
            where as {
                createdAt: {
                    $lt: Date
                }
            }
        ).createdAt.$lt.toISOString()
    }
}

export function aggregateUsage(
    rows: UsageRecord[],
    totalSource?: string,
    groupBy: NonNullable<UsageQuery['groupBy']> = 'source'
) {
    const groups = new Map<string, UsageSummaryRow>()

    for (const row of rows) {
        const source =
            totalSource ??
            (groupBy === 'model' ? `${row.platform}/${row.model}` : row.source)
        const item =
            groups.get(source) ??
            createSummaryRow(
                source,
                groupBy === 'model' && totalSource == null
                    ? row.platform
                    : undefined,
                groupBy === 'model' && totalSource == null
                    ? row.model
                    : undefined
            )

        item.calls += 1
        item.inputTokens += row.inputTokens
        item.outputTokens += row.outputTokens
        item.totalTokens += row.totalTokens
        if (row.estimated) item.estimatedTokens += row.totalTokens
        if (row.callType === 'llm') item.llmCalls += 1
        if (row.callType === 'embeddings') item.embeddingsCalls += 1
        if (row.callType === 'reranker') item.rerankerCalls += 1
        item.estimatedRatio =
            item.totalTokens > 0 ? item.estimatedTokens / item.totalTokens : 0

        groups.set(item.source, item)
    }

    if (groups.size === 0 && totalSource != null) {
        groups.set(totalSource, createSummaryRow(totalSource))
    }

    return [...groups.values()].sort(
        (left, right) => right.totalTokens - left.totalTokens
    )
}

function createSummaryRow(
    source: string,
    platform?: string,
    model?: string
): UsageSummaryRow {
    return {
        source,
        platform,
        model,
        calls: 0,
        llmCalls: 0,
        embeddingsCalls: 0,
        rerankerCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedTokens: 0,
        estimatedRatio: 0
    }
}

declare module 'koishi' {
    interface Events {
        'chatluna/model-usage'(payload: ModelUsagePayload): Promise<void>
    }

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
