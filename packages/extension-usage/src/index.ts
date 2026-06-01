import { resolve } from 'path'
import { Context, h, Logger, Schema, Time } from 'koishi'
import { DataService } from '@koishijs/plugin-console'
import type { UsageMetadata } from '@langchain/core/messages'
import type { ModelUsageCallType } from 'koishi-plugin-chatluna/llm-core/platform/usage'
import type {} from 'koishi-plugin-puppeteer'
import { renderTokenTrend } from './renderer'

const logger = new Logger('chatluna-usage')

const RANGE_ALIASES: Record<string, ChatLunaUsage.TokenRange> = {
    d: 'day',
    day: 'day',
    w: 'week',
    week: 'week',
    m: 'month',
    month: 'month',
    a: 'all',
    all: 'all'
}

// Normalize a bare token like "d" / "day" / "-d" into a TokenRange.
function toTokenRange(value: string): ChatLunaUsage.TokenRange | undefined {
    return RANGE_ALIASES[value.replace(/^-+/, '').trim().toLowerCase()]
}

function label(range: ChatLunaUsage.TokenRange) {
    if (range === 'day') return '天'
    if (range === 'week') return '周'
    if (range === 'month') return '月'
    return '全部'
}

function formatNumber(value: number) {
    return value.toLocaleString('en-US')
}

function formatDate(date: Date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const min = String(date.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${d} ${h}:${min}`
}

function formatTokenReport(report: ChatLunaUsage.TokenReport) {
    return [
        `Chatluna token 用量（${report.label}）`,
        `时间范围：${formatDate(report.start)} 至 ${formatDate(report.end)}`,
        `累计 token：${formatNumber(report.totalTokens)}`,
        `累计请求：${formatNumber(report.calls)}次`,
        `TPM：${formatNumber(report.tpm)}`,
        `RPM：${formatNumber(report.rpm)}次`
    ].join('\n')
}

function createTokenReport(
    range: ChatLunaUsage.TokenRange,
    start: Date,
    end: Date,
    rows: ChatLunaUsage.Record[],
    withPlugins = false
): ChatLunaUsage.TokenReport {
    const sorted = rows.slice().sort((a, b) => +a.createdAt - +b.createdAt)
    const from = range === 'all' ? (sorted[0]?.createdAt ?? end) : start
    const minutes = new Map<number, { tokens: number; calls: number }>()
    let totalTokens = 0
    let tpm = 0
    let rpm = 0

    for (const row of sorted) {
        const tokens = row.usageMetadata.total_tokens
        const key = Math.floor(+row.createdAt / Time.minute) * Time.minute
        const item = minutes.get(key) ?? { tokens: 0, calls: 0 }
        item.tokens += tokens
        item.calls += 1
        totalTokens += tokens
        if (item.tokens > tpm) tpm = item.tokens
        if (item.calls > rpm) rpm = item.calls
        minutes.set(key, item)
    }

    return {
        range,
        label: label(range),
        start: from,
        end,
        totalTokens,
        calls: sorted.length,
        tpm,
        rpm,
        points: tokenPoints(range, from, end, sorted),
        plugins: withPlugins ? pluginUsage(sorted) : undefined
    }
}

function pluginUsage(
    rows: ChatLunaUsage.Record[]
): ChatLunaUsage.PluginUsage[] {
    const map = new Map<string, ChatLunaUsage.PluginUsage>()

    for (const row of rows) {
        const source = row.source || 'unknown'
        const item = map.get(source) ?? { source, tokens: 0, calls: 0 }
        item.tokens += row.usageMetadata.total_tokens
        item.calls += 1
        map.set(source, item)
    }

    return [...map.values()].sort((a, b) => b.tokens - a.tokens)
}

function tokenPoints(
    range: ChatLunaUsage.TokenRange,
    start: Date,
    end: Date,
    rows: ChatLunaUsage.Record[]
) {
    if (!rows.length) return []

    // d buckets by 2 hours; w by day; m by 2 days; a by dynamic days.
    const hourly = range === 'day'
    const step =
        range === 'day'
            ? 2 * Time.hour
            : range === 'month'
              ? 2 * Time.day
              : range === 'all'
                ? Math.max(
                      Time.day,
                      Math.ceil((+end - +start) / Time.day / 15) * Time.day
                  )
                : Time.day
    const result: ChatLunaUsage.TokenPoint[] = []

    for (let at = +start; at < +end; at += step) {
        const date = new Date(at)
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        const h = String(date.getHours()).padStart(2, '0')
        result.push({
            label: hourly ? `${m}-${d} ${h}:00` : `${m}-${d}`,
            tokens: 0,
            inputTokens: 0,
            outputTokens: 0
        })
    }

    for (const row of rows) {
        const idx = Math.floor((+row.createdAt - +start) / step)
        if (result[idx]) {
            result[idx].tokens += row.usageMetadata.total_tokens
            result[idx].inputTokens += row.usageMetadata.input_tokens
            result[idx].outputTokens += row.usageMetadata.output_tokens
        }
    }

    return result
}

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
                usageMetadata: {
                    type: 'json',
                    nullable: false,
                    initial: {
                        input_tokens: 0,
                        output_tokens: 0,
                        total_tokens: 0
                    }
                },
                estimated: 'boolean',
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
                    usageMetadata: usage.usageMetadata,
                    estimated: usage.estimated,
                    success: usage.success,
                    createdAt: usage.createdAt,
                    conversationId: usage.context?.conversationId ?? null,
                    requestId: usage.context?.requestId ?? null,
                    userId: usage.context?.userId ?? null,
                    guildId: usage.context?.guildId ?? null
                })
                if (config.webui) await this.refresh()
            } catch (e) {
                logger.error(e)
            }
        })

        ctx.command(
            'tokens [...args:string]',
            '查看 ChatLuna 整体 token 消耗趋势',
            { authority: 1 }
        )
            .alias('/tokens')
            .option('day', '-d 按天统计')
            .option('week', '-w 按一周统计')
            .option('month', '-m 按一月统计')
            .option('all', '-a 统计全部')
            .option('plugin', '-p 附带各插件用量明细')
            .usage(
                '示例：/tokens / /tokens day / /tokens -d / /tokens d，附带插件明细 /tokens -p'
            )
            .action(async ({ session, options }, ...args) => {
                let range: ChatLunaUsage.TokenRange | undefined
                if (options.all) range = 'all'
                else if (options.month) range = 'month'
                else if (options.week) range = 'week'
                else if (options.day) range = 'day'

                let plugin = Boolean(options.plugin)

                for (const arg of args) {
                    const resolved = toTokenRange(arg)
                    if (resolved) {
                        range = resolved
                        continue
                    }
                    const keyword = arg.replace(/^-+/, '').trim().toLowerCase()
                    if (keyword === 'p' || keyword === 'plugin') {
                        plugin = true
                        continue
                    }
                    return '参数只能是 day、week、month、all（或简写 d/w/m/a），以及 plugin（或 p）。'
                }

                try {
                    const report = await this.tokenReport(
                        range ?? 'day',
                        plugin
                    )
                    await session.send(formatTokenReport(report))

                    if (!ctx.puppeteer) {
                        await session.send('图表渲染需要启用 puppeteer 服务。')
                        return
                    }

                    const image = await renderTokenTrend(
                        ctx,
                        report,
                        this.config.tokensTheme
                    )
                    await session.send(
                        typeof image === 'string'
                            ? h.text(image)
                            : h.image(image, 'image/png')
                    )
                } catch (e) {
                    logger.error(e)
                    return 'ChatLuna token 用量统计失败，请检查日志。'
                }
            })

        if (!config.webui) return

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
                prod: resolve(__dirname, '../dist')
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
            reasoningTokens: 0,
            successRate: 0
        }

        for (const row of rows) {
            const key = this.groupKey(row, groupBy)
            const item = groups.get(key) ?? {
                key,
                label: this.groupLabel(key, groupBy),
                platform: groupBy === 'model' ? row.platform : undefined,
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
            const model = models.get(row.model) ?? {
                key: row.model,
                label: row.model,
                platform: row.platform,
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
                reasoningTokens: 0,
                successRate: 0
            }
            const date = this.dateKey(row.createdAt, input.period ?? 'day')
            const point = timeline.get(date) ?? {
                date,
                calls: 0,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                cachedTokens: 0,
                reasoningTokens: 0
            }

            this.add(row, item)
            this.add(row, model)
            this.add(row, source)
            this.add(row, totals)
            point.calls += 1
            point.inputTokens += row.usageMetadata.input_tokens
            point.outputTokens += row.usageMetadata.output_tokens
            point.totalTokens += row.usageMetadata.total_tokens
            point.cachedTokens +=
                (row.usageMetadata.input_token_details?.cache_read ?? 0) +
                (row.usageMetadata.input_token_details?.cache_creation ?? 0)
            point.reasoningTokens +=
                row.usageMetadata.output_token_details?.reasoning ?? 0
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

    private async tokenReport(
        range: ChatLunaUsage.TokenRange,
        withPlugins = false
    ) {
        const end = new Date()
        const start =
            range === 'day'
                ? new Date(+end - Time.day)
                : range === 'week'
                  ? new Date(+end - 7 * Time.day)
                  : range === 'month'
                    ? new Date(+end - 30 * Time.day)
                    : end
        const time = range === 'all' ? { $lt: end } : { $gte: start, $lt: end }
        const rows = (await this.ctx.database.get('chatluna_usage', {
            createdAt: time
        })) as ChatLunaUsage.Record[]

        return createTokenReport(range, start, end, rows, withPlugins)
    }

    private async search(input: ChatLunaUsage.Query) {
        const query = this.withDefaults(input)
        const where: Record<string, unknown> = {
            createdAt: { $gte: query.start, $lt: query.end }
        }
        if (query.source) where.source = query.source
        if (query.model) where.model = query.model
        if (query.platform) where.platform = query.platform
        if (query.callType) where.callType = query.callType
        if (query.success != null) where.success = query.success
        if (query.estimated != null) where.estimated = query.estimated

        const rows = (await this.ctx.database.get(
            'chatluna_usage',
            where
        )) as ChatLunaUsage.Record[]

        if (
            !query.chatPlatform &&
            !query.guildId &&
            !query.userId &&
            !query.keyword
        ) {
            return rows
        }

        return rows.filter((row) => {
            if (
                query.chatPlatform &&
                !(row.chatPlatform ?? '').includes(query.chatPlatform)
            ) {
                return false
            }
            if (query.guildId && !(row.guildId ?? '').includes(query.guildId)) {
                return false
            }
            if (query.userId && !(row.userId ?? '').includes(query.userId)) {
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
                inputTokens: row.usageMetadata.input_tokens,
                outputTokens: row.usageMetadata.output_tokens,
                totalTokens: row.usageMetadata.total_tokens,
                estimated: row.estimated,
                cachedTokens:
                    (row.usageMetadata.input_token_details?.cache_read ?? 0) +
                    (row.usageMetadata.input_token_details?.cache_creation ??
                        0),
                reasoningTokens:
                    row.usageMetadata.output_token_details?.reasoning ?? 0
            }))
            .sort((a, b) => {
                const left = a[query.listSortBy] as unknown
                const right = b[query.listSortBy] as unknown
                let diff: number
                if (left instanceof Date && right instanceof Date) {
                    diff = +left - +right
                } else if (
                    typeof left === 'string' &&
                    typeof right === 'string'
                ) {
                    diff = left.localeCompare(right)
                } else {
                    diff = Number(left) - Number(right)
                }
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
        item.inputTokens += row.usageMetadata.input_tokens
        item.outputTokens += row.usageMetadata.output_tokens
        item.totalTokens += row.usageMetadata.total_tokens
        item.cachedTokens +=
            (row.usageMetadata.input_token_details?.cache_read ?? 0) +
            (row.usageMetadata.input_token_details?.cache_creation ?? 0)
        item.reasoningTokens +=
            row.usageMetadata.output_token_details?.reasoning ?? 0
        if (row.estimated)
            item.estimatedTokens += row.usageMetadata.total_tokens
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
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        if (period === 'year') return String(y)
        if (period === 'month') return `${y}-${m}`
        return `${y}-${m}-${d}`
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
    export type TokenRange = 'day' | 'week' | 'month' | 'all'
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

    export interface TokenPoint {
        label: string
        tokens: number
        inputTokens: number
        outputTokens: number
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
        tokensTheme: 'light' | 'dark'
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
            Schema.const('light').description('浅色主题'),
            Schema.const('dark').description('深色主题')
        ])
            .description('tokens命令渲染主题。')
            .default('light')
            .role('select')
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
    required: ['chatluna', 'database'],
    optional: ['console', 'puppeteer']
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
