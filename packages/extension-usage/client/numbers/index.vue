<template>
    <div class="chatluna-usage-number-grid" v-if="usage">
        <k-slot name="chatluna-usage-number">
            <k-slot-item>
                <article class="usage-metric-card">
                    <span class="metric-label">总请求数</span>
                    <strong class="metric-value">
                        {{ compact.format(usage.totals.calls) }}
                    </strong>
                </article>

                <article class="usage-metric-card">
                    <span class="metric-label">成功率</span>
                    <strong class="metric-value">
                        {{ pct(usage.totals.successRate).slice(0, -1) }}
                        <small>%</small>
                    </strong>
                    <div class="metric-progress">
                        <span
                            :style="{ width: pct(usage.totals.successRate) }"
                        ></span>
                    </div>
                </article>

                <article class="usage-metric-card token-card">
                    <span class="metric-label">Token 统计</span>
                    <div class="token-columns">
                        <div v-for="item in tokens" :key="item.label">
                            <span>{{ item.label }}</span>
                            <strong>{{ item.value }}</strong>
                        </div>
                    </div>
                </article>

                <article class="usage-metric-card">
                    <span class="metric-label">今日请求</span>
                    <strong class="metric-value accent-value">
                        {{ req.day == null ? '-' : fmt(req.day) }}
                    </strong>
                </article>
            </k-slot-item>
        </k-slot>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import { fmt, pct, query, usage } from '../state'

const compact = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1
})
const req = ref<{ day?: number }>({})
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
        day.setHours(0, 0, 0, 0)
        req.value = {}

        try {
            const result = await send('chatluna-usage/query', {
                ...query,
                period: 'day',
                start: day,
                end: now,
                page: 1
            })

            if (idx === reqId) req.value = { day: result.totals.calls }
        } catch {
            if (idx === reqId) ElMessage.error('查询今日请求失败')
        }
    },
    { immediate: true }
)

const tokens = computed(() => {
    const item = usage.value?.totals
    if (!item) return []

    const big = (n: number) => (n >= 1000000 ? compact.format(n) : fmt(n))

    return [
        { label: '输入', value: big(item.inputTokens) },
        { label: '输出', value: big(item.outputTokens) },
        { label: '缓存', value: big(item.cachedTokens) }
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
