import { Context, Logger, Schema, Time } from 'koishi'
import { DataService } from '@koishijs/plugin-console'
import { resolve } from 'path'
import type { ModelUsageCallType } from 'koishi-plugin-chatluna/llm-core/platform/usage'

const logger = new Logger('chatluna-usage')

class ChatLunaUsage extends DataService<ChatLunaUsage.Payload> {
    constructor(
        ctx: Context,
        public config: ChatLunaUsage.Config
    ) {
        super(ctx, 'chatluna_usage', {
            immediate: true
        })

        ctx.database.extend(
            'chatluna_usage',
            {
                id: 'unsigned',
                source: { type: 'char', length: 128 },
                callType: { type: 'char', length: 20 },
                platform: { type: 'char', length: 128 },
                chatPlatform: { type: 'char', length: 128, nullable: true },
                model: { type: 'char', length: 255 },
                tokens: {
                    type: 'json',
                    nullable: false,
                    initial: {
                        input: 0,
                        output: 0,
                        total: 0,
                        estimated: false,
                        cacheRead: 0,
                        cacheCreation: 0
                    }
                },
                success: 'boolean',
                createdAt: { type: 'timestamp', nullable: false },
                conversationId: { type: 'char', length: 255, nullable: true },
                requestId: { type: 'char', length: 255, nullable: true },
                userId: { type: 'char', length: 255, nullable: true },
                guildId: { type: 'char', length: 255, nullable: true }
            },
            {
                autoInc: true,
                primary: 'id',
                indexes: ['createdAt', 'source', 'model', 'guildId']
            }
        )

        ctx.on('chatluna/model-usage', async (usage) => {
            try {
                await ctx.database.create('chatluna_usage', {
                    source: usage.source,
                    callType: usage.callType,
                    platform: usage.platform,
                    chatPlatform: usage.context?.chatPlatform ?? null,
                    model: usage.model,
                    tokens: usage.tokens,
                    success: usage.success,
                    createdAt: usage.createdAt,
                    conversationId: usage.context?.conversationId ?? null,
                    requestId: usage.context?.requestId ?? null,
                    userId: usage.context?.userId ?? null,
                    guildId: usage.context?.guildId ?? null
                })
                await this.refresh()
            } catch (e) {
                logger.error(e)
            }
        })

        ctx.inject(['console'], (ctx) => {
            ctx.console.addListener('chatluna-usage/query', async (input) =>
                this.query(input)
            )

            ctx.console.addListener('chatluna-usage/list', async (input) =>
                this.list(input)
            )

            ctx.console.addListener(
                'chatluna-usage/cleanup',
                async (before) => {
                    await this.cleanup(before ? new Date(before) : undefined)
                    await this.refresh()
                    return { success: true }
                }
            )

            ctx.console.addEntry({
                dev: resolve(__dirname, '../client/index.ts'),
                prod: resolve(
                    ctx.baseDir,
                    'node_modules',
                    'koishi-plugin-chatluna-usage',
                    'dist'
                )
            })
        })
    }

    async get() {
        return await this.query()
    }

    async query(input: ChatLunaUsage.Query = {}) {
        const rows = await this.search(input)
        const groupBy = input.groupBy ?? 'model'
        const sortBy = input.sortBy ?? 'totalTokens'
        const desc = input.desc ?? true
        const groups = new Map<string, ChatLunaUsage.Summary>()
        const models = new Map<string, ChatLunaUsage.Summary>()
        const sources = new Map<string, ChatLunaUsage.Summary>()
        const timeline = new Map<string, ChatLunaUsage.Timeline>()
        const modelTimeline = new Map<string, Map<string, number>>()
        const totals: ChatLunaUsage.Summary = {
            key: 'total',
            label: '全部用量',
            calls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedTokens: 0,
            cachedTokens: 0,
            successRate: 0
        }

        for (const row of rows) {
            const key = this.groupKey(row, groupBy)
            const item = groups.get(key) ?? {
                key,
                label: this.groupLabel(key, groupBy),
                calls: 0,
                successfulCalls: 0,
                failedCalls: 0,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                estimatedTokens: 0,
                cachedTokens: 0,
                successRate: 0
            }
            const model = models.get(row.model) ?? {
                key: row.model,
                label: row.model,
                calls: 0,
                successfulCalls: 0,
                failedCalls: 0,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                estimatedTokens: 0,
                cachedTokens: 0,
                successRate: 0
            }
            const source = sources.get(row.source) ?? {
                key: row.source,
                label: row.source,
                calls: 0,
                successfulCalls: 0,
                failedCalls: 0,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                estimatedTokens: 0,
                cachedTokens: 0,
                successRate: 0
            }
            const date = this.dateKey(row.createdAt, input.period ?? 'day')
            const point = timeline.get(date) ?? {
                date,
                calls: 0,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                cachedTokens: 0
            }

            this.add(row, item)
            this.add(row, model)
            this.add(row, source)
            this.add(row, totals)
            point.calls += 1
            point.inputTokens += row.tokens.input
            point.outputTokens += row.tokens.output
            point.totalTokens += row.tokens.total
            point.cachedTokens +=
                row.tokens.cacheRead + row.tokens.cacheCreation
            if (!modelTimeline.has(row.model))
                modelTimeline.set(row.model, new Map())
            modelTimeline
                .get(row.model)
                .set(date, (modelTimeline.get(row.model).get(date) ?? 0) + 1)
            groups.set(key, item)
            models.set(row.model, model)
            sources.set(row.source, source)
            timeline.set(date, point)
        }

        this.finish(totals)

        return {
            query: this.withDefaults(input),
            totals,
            groups: [...groups.values()]
                .map((row) => this.finish(row))
                .sort((a, b) => {
                    const diff = a[sortBy] - b[sortBy]
                    return desc ? -diff : diff
                }),
            models: [...models.values()]
                .map((row) => this.finish(row))
                .sort((a, b) => b.calls - a.calls),
            sources: [...sources.values()]
                .map((row) => this.finish(row))
                .sort((a, b) => b.calls - a.calls),
            timeline: [...timeline.values()].sort((a, b) =>
                a.date.localeCompare(b.date)
            ),
            modelTimeline: [...modelTimeline.entries()].map(
                ([model, dates]) => ({
                    model,
                    points: [...dates.entries()]
                        .map(([date, calls]) => ({ date, calls }))
                        .sort((a, b) => a.date.localeCompare(b.date))
                })
            ),
            list: this.pageRows(rows, input)
        }
    }

    async list(input: ChatLunaUsage.Query = {}) {
        const rows = await this.search(input)
        return this.pageRows(rows, input)
    }

    async cleanup(before?: Date) {
        await this.ctx.database.remove(
            'chatluna_usage',
            before ? { createdAt: { $lt: before } } : {}
        )
    }

    private async search(input: ChatLunaUsage.Query) {
        const query = this.withDefaults(input)
        const rows = (await this.ctx.database.get('chatluna_usage', {
            createdAt: { $gte: query.start, $lt: query.end }
        })) as ChatLunaUsage.Record[]

        return rows.filter((row) => {
            if (query.source && row.source !== query.source) return false
            if (query.model && row.model !== query.model) return false
            if (query.platform && row.platform !== query.platform) return false
            if (
                query.chatPlatform &&
                !(row.chatPlatform ?? '').includes(query.chatPlatform)
            ) {
                return false
            }
            if (query.callType && row.callType !== query.callType) return false
            if (query.guildId && !(row.guildId ?? '').includes(query.guildId)) {
                return false
            }
            if (query.userId && !(row.userId ?? '').includes(query.userId)) {
                return false
            }
            if (query.success != null && row.success !== query.success)
                return false
            if (
                query.estimated != null &&
                row.tokens.estimated !== query.estimated
            ) {
                return false
            }
            if (!query.keyword) return true

            return [
                row.source,
                row.callType,
                row.platform,
                row.chatPlatform,
                row.model,
                row.conversationId,
                row.requestId,
                row.userId,
                row.guildId
            ]
                .filter(Boolean)
                .some((value) => value.includes(query.keyword))
        })
    }

    private withDefaults(input: ChatLunaUsage.Query) {
        const period = input.period ?? 'day'
        const end = input.end ? new Date(input.end) : new Date()
        const start = input.start
            ? new Date(input.start)
            : period === 'year'
              ? new Date(end.getFullYear() - 1, end.getMonth(), end.getDate())
              : period === 'month'
                ? new Date(end.getFullYear(), end.getMonth() - 11, 1)
                : new Date(+end - this.config.recentDays * Time.day)

        return {
            ...input,
            period,
            groupBy: input.groupBy ?? 'model',
            sortBy: input.sortBy ?? 'totalTokens',
            desc: input.desc ?? true,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? this.config.pageSize,
            listSortBy: input.listSortBy ?? 'createdAt',
            listDesc: input.listDesc ?? true,
            start,
            end
        }
    }

    private pageRows(rows: ChatLunaUsage.Record[], input: ChatLunaUsage.Query) {
        const query = this.withDefaults(input)
        const sorted = rows
            .map((row) => ({
                ...row,
                inputTokens: row.tokens.input,
                outputTokens: row.tokens.output,
                totalTokens: row.tokens.total,
                estimated: row.tokens.estimated,
                cachedTokens: row.tokens.cacheRead + row.tokens.cacheCreation
            }))
            .sort((a, b) => {
                const left = a[query.listSortBy]
                const right = b[query.listSortBy]
                const diff =
                    left instanceof Date && right instanceof Date
                        ? +left - +right
                        : Number(left) - Number(right)
                return query.listDesc ? -diff : diff
            })
        const start = (query.page - 1) * query.pageSize

        return {
            total: sorted.length,
            page: query.page,
            pageSize: query.pageSize,
            rows: sorted.slice(start, start + query.pageSize)
        }
    }

    private add(row: ChatLunaUsage.Record, item: ChatLunaUsage.Summary) {
        item.calls += 1
        if (row.success) item.successfulCalls += 1
        else item.failedCalls += 1
        item.inputTokens += row.tokens.input
        item.outputTokens += row.tokens.output
        item.totalTokens += row.tokens.total
        item.cachedTokens += row.tokens.cacheRead + row.tokens.cacheCreation
        if (row.tokens.estimated) item.estimatedTokens += row.tokens.total
        if (!item.lastSeen || row.createdAt > item.lastSeen)
            item.lastSeen = row.createdAt
    }

    private finish(item: ChatLunaUsage.Summary) {
        item.successRate = item.calls ? item.successfulCalls / item.calls : 0
        return item
    }

    private groupKey(
        row: ChatLunaUsage.Record,
        groupBy: ChatLunaUsage.GroupBy
    ) {
        if (groupBy === 'guild') return row.guildId ?? 'private'
        if (groupBy === 'chatPlatform') return row.chatPlatform ?? 'unknown'
        return row[groupBy]
    }

    private groupLabel(key: string, groupBy: ChatLunaUsage.GroupBy) {
        if (groupBy === 'guild' && key === 'private') return '私聊/未知群'
        if (groupBy === 'chatPlatform' && key === 'unknown')
            return '未知聊天平台'
        return key
    }

    private dateKey(date: Date, period: ChatLunaUsage.Period) {
        if (period === 'year') return String(date.getFullYear())
        if (period === 'month') return date.toISOString().slice(0, 7)
        return date.toISOString().slice(0, 10)
    }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ChatLunaUsage {
    export interface Record {
        id?: number
        source: string
        callType: ModelUsageCallType
        platform: string
        chatPlatform?: string | null
        model: string
        tokens: Tokens
        success: boolean
        createdAt: Date
        conversationId?: string | null
        requestId?: string | null
        userId?: string | null
        guildId?: string | null
    }

    export interface Tokens {
        input: number
        output: number
        total: number
        estimated: boolean
        cacheRead: number
        cacheCreation: number
    }

    export interface ListRow extends Record {
        inputTokens: number
        outputTokens: number
        totalTokens: number
        estimated: boolean
        cachedTokens: number
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
        | 'successRate'
    export type ListSortBy =
        | 'createdAt'
        | 'inputTokens'
        | 'outputTokens'
        | 'totalTokens'
        | 'cachedTokens'

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
        calls: number
        successfulCalls: number
        failedCalls: number
        inputTokens: number
        outputTokens: number
        totalTokens: number
        estimatedTokens: number
        cachedTokens: number
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
    }

    export interface ActionResult {
        success: boolean
    }

    export const Config: Schema<Config> = Schema.object({
        recentDays: Schema.natural()
            .description('默认统计最近几天的数据。')
            .default(30),
        pageSize: Schema.natural().description('调用明细分页大小。').default(50)
    })

    export const inject = ['chatluna', 'database']
}

export default ChatLunaUsage
export { ChatLunaUsage }

export async function queryUsage(ctx: Context, source?: string) {
    const result = await ctx.chatluna_usage.query({ groupBy: 'source' })
    if (!source) return result.groups
    return result.groups.filter((row) => row.key === source)
}

export async function cleanupUsage(ctx: Context, before?: Date) {
    await ctx.chatluna_usage.cleanup(before)
}

export function apply(ctx: Context, config: ChatLunaUsage.Config) {
    ctx.plugin(ChatLunaUsage, config)
}

export const Config = ChatLunaUsage.Config

export const inject = {
    required: ['chatluna', 'database', 'console']
}

export const name = 'chatluna-usage'

declare module 'koishi' {
    interface Context {
        chatluna_usage: ChatLunaUsage
    }

    interface Tables {
        chatluna_usage: ChatLunaUsage.Record
    }
}

declare module '@koishijs/plugin-console' {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Console {
        interface Services {
            chatluna_usage: ChatLunaUsage
        }
    }

    interface Events {
        'chatluna-usage/query': (
            input?: ChatLunaUsage.Query
        ) => Promise<ChatLunaUsage.Payload>
        'chatluna-usage/list': (
            input?: ChatLunaUsage.Query
        ) => Promise<ChatLunaUsage.List>
        'chatluna-usage/cleanup': (
            before?: string
        ) => Promise<ChatLunaUsage.ActionResult>
    }
}
