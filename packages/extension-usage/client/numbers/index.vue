<template>
    <div class="chatluna-usage-number-grid" v-if="usage">
        <k-slot name="chatluna-usage-number">
            <k-slot-item>
                <article class="usage-metric-card request-card">
                    <span class="metric-title">
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
                            <span class="metric-label">Token 统计</span>
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
                            <span class="metric-label">今日请求</span>
                        </span>
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
import { fmt, pct, query, short, usage } from '../state'

const compact = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1
})
const req = ref<{ day?: number; week?: number; month?: number; prev?: number }>(
    {}
)
let reqId = 0

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
    const item = usage.value?.totals
    if (!item) return []

    return [
        { label: '输入', value: short(item.inputTokens) },
        { label: '输出', value: short(item.outputTokens) },
        { label: '思考', value: short(item.reasoningTokens) },
        { label: '缓存', value: short(item.cachedTokens) }
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
