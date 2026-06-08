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

const RANGES = {
    day: ['天', 2 * Time.hour],
    week: ['周', Time.day],
    month: ['月', 2 * Time.day],
    all: ['全部', 0]
} as const

const pad = (value: number) => String(value).padStart(2, '0')

export function formatDate(date: Date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatTokenReport(report: TokenReport) {
    return [
        `Chatluna token 用量（${report.label}）`,
        `时间范围：${formatDate(report.start)} 至 ${formatDate(report.end)}`,
        `累计 token：${report.totalTokens.toLocaleString('en-US')}`,
        `累计请求：${report.calls.toLocaleString('en-US')}次`,
        `TPM：${report.tpm.toLocaleString('en-US')}`,
        `RPM：${report.rpm.toLocaleString('en-US')}次`
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
    const step =
        range === 'all'
            ? Math.max(
                  Time.day,
                  Math.ceil((+end - +from) / Time.day / 15) * Time.day
              )
            : RANGES[range][1]
    const aligned = new Date(from)
    const plugins = new Map<string, PluginUsage>()
    let totalTokens = 0
    let tpm = 0
    let rpm = 0
    let minute = -1
    let minuteTokens = 0
    let minuteCalls = 0

    if (range === 'day') aligned.setMinutes(0, 0, 0)
    else aligned.setHours(0, 0, 0, 0)

    const points: TokenPoint[] = sorted.length
        ? Array.from(
              { length: Math.ceil((+end - +aligned) / step) },
              (_, i) => {
                  const date = new Date(+aligned + i * step)
                  const label = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
                  return {
                      label:
                          range === 'day'
                              ? `${label} ${pad(date.getHours())}:00`
                              : label,
                      tokens: 0,
                      inputTokens: 0,
                      outputTokens: 0
                  }
              }
          )
        : []

    for (const row of sorted) {
        const tokens = row.usageMetadata.total_tokens
        const key = Math.floor(+row.createdAt / Time.minute) * Time.minute
        const point = points[Math.floor((+row.createdAt - +aligned) / step)]
        if (key === minute) {
            minuteTokens += tokens
            minuteCalls += 1
        } else {
            tpm = Math.max(tpm, minuteTokens)
            rpm = Math.max(rpm, minuteCalls)
            minute = key
            minuteTokens = tokens
            minuteCalls = 1
        }
        totalTokens += tokens
        if (point) {
            point.tokens += tokens
            point.inputTokens += row.usageMetadata.input_tokens
            point.outputTokens += row.usageMetadata.output_tokens
        }
        if (withPlugins) {
            const plugin = plugins.get(row.source) ?? {
                source: row.source,
                tokens: 0,
                calls: 0
            }
            plugin.tokens += tokens
            plugin.calls += 1
            plugins.set(row.source, plugin)
        }
    }
    tpm = Math.max(tpm, minuteTokens)
    rpm = Math.max(rpm, minuteCalls)

    return {
        range,
        label: RANGES[range][0],
        start: from,
        end,
        totalTokens,
        calls: sorted.length,
        tpm,
        rpm,
        points,
        plugins: withPlugins
            ? [...plugins.values()].sort((a, b) => b.tokens - a.tokens)
            : undefined
    }
}
