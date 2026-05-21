<template>
    <div class="chatluna-usage-number-grid" v-if="usage">
        <k-slot name="chatluna-usage-number">
            <k-slot-item>
                <article class="usage-metric-card request-card">
                    <span class="metric-title">
                        <svg
                            class="metric-title-icon"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                        >
                            <ellipse
                                cx="12"
                                cy="5"
                                rx="7"
                                ry="3"
                                stroke="currentColor"
                                stroke-width="2"
                            />
                            <path
                                d="M5 5v14c0 1.66 3.13 3 7 3s7-1.34 7-3V5"
                                stroke="currentColor"
                                stroke-width="2"
                            />
                            <path
                                d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3"
                                stroke="currentColor"
                                stroke-width="2"
                            />
                        </svg>
                        <span class="metric-label">总请求数</span>
                    </span>
                    <strong class="metric-value">
                        {{ compact.format(usage.totals.calls) }}
                    </strong>
                    <div class="metric-compare">
                        <span
                            class="metric-badge"
                            :class="{
                                up: diff != null && diff > 0,
                                down: diff != null && diff < 0
                            }"
                        >
                            {{ diffText }}
                        </span>
                        <span>较上周</span>
                    </div>
                </article>

                <article class="usage-metric-card success-card">
                    <span class="metric-title">
                        <svg
                            class="metric-title-icon"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                        >
                            <path
                                d="M12 3 19 6v6c0 4.5-2.8 7.74-7 9-4.2-1.26-7-4.5-7-9V6l7-3Z"
                                stroke="currentColor"
                                stroke-linejoin="round"
                                stroke-width="2"
                            />
                            <path
                                d="m8.6 12.3 2.1 2.1 4.7-5"
                                stroke="currentColor"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                            />
                        </svg>
                        <span class="metric-label">成功率</span>
                    </span>
                    <strong class="metric-value">
                        {{ pct(usage.totals.successRate).slice(0, -1) }}
                        <small>%</small>
                    </strong>
                    <div class="metric-progress">
                        <span
                            :style="{ width: pct(usage.totals.successRate) }"
                        ></span>
                    </div>
                    <div class="metric-note success-note">
                        <span>
                            {{ fmt(usage.totals.failedCalls) }} 失败请求
                        </span>
                        <span>平均值</span>
                    </div>
                </article>

                <article class="usage-metric-card token-card">
                    <header>
                        <span class="metric-title token-title">
                            <span class="token-icon" aria-hidden="true">
                                <i></i>
                                <i></i>
                                <i></i>
                            </span>
                            <span class="metric-label">Token统计</span>
                        </span>
                        <span
                            class="segment"
                            :style="{
                                '--segment-index': scopes.findIndex(
                                    (item) => item.value === scope
                                )
                            }"
                        >
                            <span class="segment-thumb"></span>
                            <button
                                v-for="item in scopes"
                                :key="item.value"
                                :class="{ active: scope === item.value }"
                                type="button"
                                @click="scope = item.value"
                            >
                                {{ item.label }}
                            </button>
                        </span>
                    </header>
                    <div class="token-columns">
                        <div v-for="item in tokens" :key="item.label">
                            <span>{{ item.label }}</span>
                            <strong>{{ item.value }}</strong>
                        </div>
                    </div>
                </article>

                <article class="usage-metric-card accent-card">
                    <header class="accent-head">
                        <span class="metric-title">
                            <svg
                                class="metric-title-icon"
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                aria-hidden="true"
                            >
                                <path
                                    d="M3 12h4l2-6 4 12 2-6h6"
                                    stroke="currentColor"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                />
                            </svg>
                            <span class="metric-label">今日请求</span>
                        </span>
                        <span class="accent-dot" aria-hidden="true"></span>
                    </header>
                    <strong>{{ req.day == null ? '-' : fmt(req.day) }}</strong>
                    <span class="accent-line"></span>
                    <div class="accent-summary">
                        <span>
                            本周:
                            {{
                                req.week == null
                                    ? '-'
                                    : compact.format(req.week)
                            }}
                        </span>
                        <span>
                            本月:
                            {{
                                req.month == null
                                    ? '-'
                                    : compact.format(req.month)
                            }}
                        </span>
                    </div>
                </article>
            </k-slot-item>
        </k-slot>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import type { ChatLunaUsage } from 'koishi-plugin-chatluna-usage'
import { fmt, pct, query, usage } from '../state'

type Scope = 'all' | 'month' | 'week' | 'day'

const scope = ref<Scope>('all')

const scopes: { label: string; value: Scope }[] = [
    { label: '全部', value: 'all' },
    { label: '月', value: 'month' },
    { label: '周', value: 'week' },
    { label: '日', value: 'day' }
]

const compact = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1
})
const total = ref<ChatLunaUsage.Summary>()
const req = ref<{ day?: number; week?: number; month?: number; prev?: number }>(
    {}
)
let id = 0
let reqId = 0

watch([scope, usage], async () => {
    if (scope.value === 'all') {
        total.value = undefined
        return
    }

    const idx = ++id
    const now = new Date()
    const start = new Date(now)
    total.value = undefined

    if (scope.value === 'day') start.setHours(0, 0, 0, 0)
    if (scope.value === 'week') start.setDate(start.getDate() - 7)
    if (scope.value === 'month') start.setMonth(start.getMonth() - 1)

    try {
        const result = await send('chatluna-usage/query', {
            ...query,
            period: 'day',
            start,
            end: now,
            page: 1
        })

        if (idx === id) total.value = result.totals
    } catch {
        if (idx === id) ElMessage.error('查询 Token 统计失败')
    }
})

watch(
    usage,
    async () => {
        if (!usage.value) {
            req.value = {}
            return
        }

        const idx = ++reqId
        const now = new Date()
        const day = new Date(now)
        const week = new Date(now)
        const month = new Date(now)
        day.setHours(0, 0, 0, 0)
        week.setDate(week.getDate() - (week.getDay() || 7) + 1)
        week.setHours(0, 0, 0, 0)
        month.setDate(1)
        month.setHours(0, 0, 0, 0)
        const prev = new Date(week)
        prev.setDate(prev.getDate() - 7)
        const prevEnd = new Date(
            prev.getTime() + now.getTime() - week.getTime()
        )
        req.value = {}

        try {
            const [dayResult, weekResult, monthResult, prevResult] =
                await Promise.all([
                    send('chatluna-usage/query', {
                        ...query,
                        period: 'day',
                        start: day,
                        end: now,
                        page: 1
                    }),
                    send('chatluna-usage/query', {
                        ...query,
                        period: 'day',
                        start: week,
                        end: now,
                        page: 1
                    }),
                    send('chatluna-usage/query', {
                        ...query,
                        period: 'day',
                        start: month,
                        end: now,
                        page: 1
                    }),
                    send('chatluna-usage/query', {
                        ...query,
                        period: 'day',
                        start: prev,
                        end: prevEnd,
                        page: 1
                    })
                ])

            if (idx === reqId) {
                req.value = {
                    day: dayResult.totals.calls,
                    week: weekResult.totals.calls,
                    month: monthResult.totals.calls,
                    prev: prevResult.totals.calls
                }
            }
        } catch {
            if (idx === reqId) ElMessage.error('查询今日请求失败')
        }
    },
    { immediate: true }
)

const diff = computed(() => {
    if (req.value.week == null || req.value.prev == null) return
    if (!req.value.prev) return req.value.week ? 1 : 0

    return (req.value.week - req.value.prev) / req.value.prev
})

const diffText = computed(() => {
    if (diff.value == null) return '-'

    return `${diff.value > 0 ? '+' : ''}${(diff.value * 100)
        .toFixed(1)
        .replace('.0', '')}%`
})

const tokens = computed(() => {
    const data = usage.value
    if (!data) return []

    const item = scope.value === 'all' ? data.totals : total.value

    return [
        {
            label: '输入',
            value: item
                ? item.inputTokens >= 1000000
                    ? compact.format(item.inputTokens)
                    : fmt(item.inputTokens)
                : '-'
        },
        {
            label: '输出',
            value: item
                ? item.outputTokens >= 1000000
                    ? compact.format(item.outputTokens)
                    : fmt(item.outputTokens)
                : '-'
        },
        {
            label: '缓存',
            value: item
                ? item.cachedTokens >= 1000000
                    ? compact.format(item.cachedTokens)
                    : fmt(item.cachedTokens)
                : '-'
        }
    ]
})
</script>

<style lang="scss" scoped>
.chatluna-usage-number-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem;

    @media screen and (max-width: 1280px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @media screen and (max-width: 768px) {
        grid-template-columns: 1fr;
    }
}
</style>
