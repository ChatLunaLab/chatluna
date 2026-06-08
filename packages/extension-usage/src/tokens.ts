import { Time } from 'koishi'
import type { ChatLunaUsage } from './index'

export type TokenRange = 'day' | 'week' | 'month' | 'all'
export type TokenTheme = 'auto' | 'light' | 'dark'

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

const RANGES: Record<string, TokenRange> = {
    d: 'day',
    day: 'day',
    w: 'week',
    week: 'week',
    m: 'month',
    month: 'month',
    a: 'all',
    all: 'all'
}

export function tokenRange(value: string): TokenRange | undefined {
    return RANGES[value.replace(/^-+/, '').trim().toLowerCase()]
}

export function tokenStart(range: TokenRange, end: Date) {
    if (range === 'day') return new Date(+end - Time.day)
    if (range === 'week') return new Date(+end - 7 * Time.day)
    if (range === 'month') return new Date(+end - 30 * Time.day)
    return end
}

export function formatDate(date: Date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const min = String(date.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${d} ${h}:${min}`
}

export function formatTokenReport(report: TokenReport) {
    return [
        `Chatluna token 用量（${report.label}）`,
        `时间范围：${formatDate(report.start)} 至 ${formatDate(report.end)}`,
        `累计 token：${formatNumber(report.totalTokens)}`,
        `累计请求：${formatNumber(report.calls)}次`,
        `TPM：${formatNumber(report.tpm)}`,
        `RPM：${formatNumber(report.rpm)}次`
    ].join('\n')
}

export function createTokenReport(
    range: TokenRange,
    start: Date,
    end: Date,
    rows: ChatLunaUsage.Record[],
    withPlugins = false
): TokenReport {
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
        label: rangeLabel(range),
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

function rangeLabel(range: TokenRange) {
    if (range === 'day') return '天'
    if (range === 'week') return '周'
    if (range === 'month') return '月'
    return '全部'
}

function formatNumber(value: number) {
    return value.toLocaleString('en-US')
}

function pluginUsage(rows: ChatLunaUsage.Record[]): PluginUsage[] {
    const map = new Map<string, PluginUsage>()

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
    range: TokenRange,
    start: Date,
    end: Date,
    rows: ChatLunaUsage.Record[]
) {
    if (!rows.length) return []

    const hourly = range === 'day'
    const step = tokenStep(range, start, end)
    const alignedStart = tokenAlignedStart(range, start)
    const result: TokenPoint[] = []

    for (let at = +alignedStart; at < +end; at += step) {
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
        const idx = Math.floor((+row.createdAt - +alignedStart) / step)
        if (result[idx]) {
            result[idx].tokens += row.usageMetadata.total_tokens
            result[idx].inputTokens += row.usageMetadata.input_tokens
            result[idx].outputTokens += row.usageMetadata.output_tokens
        }
    }

    return result
}

function tokenAlignedStart(range: TokenRange, start: Date) {
    const result = new Date(start)
    if (range === 'day') result.setMinutes(0, 0, 0)
    else result.setHours(0, 0, 0, 0)
    return result
}

function tokenStep(range: TokenRange, start: Date, end: Date) {
    if (range === 'day') return 2 * Time.hour
    if (range === 'month') return 2 * Time.day
    if (range === 'all') {
        return Math.max(
            Time.day,
            Math.ceil((+end - +start) / Time.day / 15) * Time.day
        )
    }
    return Time.day
}
