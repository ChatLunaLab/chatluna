import { Context, Schema } from 'koishi'
import type { UsageMetadata } from '@langchain/core/messages'
import type { ModelUsageCallType } from 'koishi-plugin-chatluna/llm-core/platform/usage'

export function summary(
    key: string,
    label = key,
    platform?: string
): ChatLunaUsage.Summary {
    return {
        key,
        label,
        platform,
        calls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        successRate: 0
    }
}

export function calculateTheme(): Exclude<ChatLunaUsage.TokenTheme, 'auto'> {
    const currentHours = new Date().getHours()
    return currentHours < 6 || currentHours >= 18 ? 'dark' : 'light'
}

export async function queryUsage(ctx: Context, source?: string) {
    const result = await ctx.chatluna_usage.query({ groupBy: 'source' })
    if (!source) return result.groups
    return result.groups.filter((row) => row.key === source)
}

export async function cleanupUsage(ctx: Context, before?: Date) {
    await ctx.chatluna_usage.cleanup(before)
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ChatLunaUsage {
    export interface Record {
        id?: number
        source: string
        callType: ModelUsageCallType
        platform: string
        chatPlatform?: string | null
        model: string
        usageMetadata: UsageMetadata
        estimated: boolean
        success: boolean
        createdAt: Date
        conversationId?: string | null
        requestId?: string | null
        userId?: string | null
        guildId?: string | null
    }

    export interface ListRow extends Record {
        inputTokens: number
        outputTokens: number
        totalTokens: number
        estimated: boolean
        cachedTokens: number
        reasoningTokens: number
    }

    export type Period = 'day' | 'month' | 'year'
    export type GroupBy =
        | 'source'
        | 'model'
        | 'guild'
        | 'platform'
        | 'chatPlatform'
        | 'callType'
    export type SortBy =
        | 'calls'
        | 'successfulCalls'
        | 'failedCalls'
        | 'inputTokens'
        | 'outputTokens'
        | 'totalTokens'
        | 'estimatedTokens'
        | 'cachedTokens'
        | 'reasoningTokens'
        | 'successRate'
    export type ListSortBy =
        | 'createdAt'
        | 'inputTokens'
        | 'outputTokens'
        | 'totalTokens'
        | 'cachedTokens'
        | 'reasoningTokens'

    export interface Query {
        period?: Period
        start?: string | Date
        end?: string | Date
        groupBy?: GroupBy
        sortBy?: SortBy
        desc?: boolean
        page?: number
        pageSize?: number
        listSortBy?: ListSortBy
        listDesc?: boolean
        source?: string
        model?: string
        platform?: string
        chatPlatform?: string
        callType?: ModelUsageCallType
        guildId?: string
        userId?: string
        success?: boolean
        estimated?: boolean
        keyword?: string
    }

    export interface Summary {
        key: string
        label: string
        platform?: string
        calls: number
        successfulCalls: number
        failedCalls: number
        inputTokens: number
        outputTokens: number
        totalTokens: number
        estimatedTokens: number
        cachedTokens: number
        reasoningTokens: number
        successRate: number
        lastSeen?: Date
    }

    export interface Timeline {
        date: string
        calls: number
        inputTokens: number
        outputTokens: number
        totalTokens: number
        cachedTokens: number
        reasoningTokens: number
    }

    export interface ModelTimeline {
        model: string
        points: {
            date: string
            calls: number
        }[]
    }

    export interface List {
        total: number
        page: number
        pageSize: number
        rows: ListRow[]
    }

    export type TokenRange = 'day' | 'week' | 'month' | 'all'
    export type TokenTheme = 'auto' | 'light' | 'dark'
    export type TokenRenderMode = 'both' | 'line' | 'bar'

    export interface TokenPoint {
        label: string
        tokens: number
        inputTokens: number
        outputTokens: number
        models: { [model: string]: number }
    }

    export interface PluginUsage {
        source: string
        tokens: number
        calls: number
    }

    export interface TokenReport {
        range: TokenRange
        label: string
        start: Date
        end: Date
        totalTokens: number
        calls: number
        tpm: number
        rpm: number
        points: TokenPoint[]
        plugins?: PluginUsage[]
    }

    export interface Payload {
        query: Required<
            Pick<
                Query,
                | 'period'
                | 'groupBy'
                | 'sortBy'
                | 'desc'
                | 'page'
                | 'pageSize'
                | 'listSortBy'
                | 'listDesc'
            >
        > & {
            start: Date
            end: Date
        } & Query
        totals: Summary
        groups: Summary[]
        models: Summary[]
        sources: Summary[]
        timeline: Timeline[]
        modelTimeline: ModelTimeline[]
        list: List
    }

    export interface Config {
        recentDays: number
        pageSize: number
        webui: boolean
        tokensTheme: TokenTheme
        tokensRenderMode: TokenRenderMode
    }

    export interface TokenCommandOptions {
        day?: boolean
        week?: boolean
        month?: boolean
        all?: boolean
        plugin?: boolean
    }

    export interface ActionResult {
        success: boolean
    }

    export const Config: Schema<Config> = Schema.object({
        recentDays: Schema.natural()
            .description('默认统计最近几天的数据。')
            .default(30),
        pageSize: Schema.natural()
            .description('调用明细分页大小。')
            .default(50),
        webui: Schema.boolean()
            .description('启用 Web UI 控制台用量面板。')
            .default(true),
        tokensTheme: Schema.union([
            Schema.const('auto').description('自动'),
            Schema.const('light').description('浅色模式'),
            Schema.const('dark').description('深色模式')
        ])
            .description('tokens命令渲染出的图表颜色主题')
            .default('auto')
            .role('select'),
        tokensRenderMode: Schema.union([
            Schema.const('both').description('曲线和柱状图'),
            Schema.const('line').description('仅曲线'),
            Schema.const('bar').description('仅柱状图')
        ])
            .description('tokens命令渲染出的图表展示模式')
            .default('bar')
            .role('select')
    })

    export const inject = ['chatluna', 'database']
}
