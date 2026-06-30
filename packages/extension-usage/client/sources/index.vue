<template>
    <aside class="chatluna-usage-source-panel">
        <header>
            <div>
                <p>插件消耗分布</p>
            </div>
            <strong class="source-total">
                <span>消耗总量</span>
                {{ short(tokens) }}
            </strong>
        </header>

        <div class="source-chart-body" v-if="rows.length && tokens">
            <v-chart
                class="source-pie"
                :option="option"
                autoresize
                @click="click"
            />

            <section class="source-detail">
                <transition name="source-detail-content" mode="out-in">
                    <div :key="active">
                        <header>
                            <span>{{ title }}</span>
                        </header>

                        <div class="source-model-list" v-if="models.length">
                            <div
                                class="source-model-row"
                                v-for="row in models"
                                :key="row.key"
                            >
                                <el-tooltip
                                    :content="
                                        row.platform
                                            ? `${row.platform}/${row.label}`
                                            : row.label
                                    "
                                    placement="top"
                                    effect="dark"
                                >
                                    <span class="source-model-name">
                                        {{ row.platform ? `${row.platform}/` : '' }}{{ row.label }}
                                    </span>
                                </el-tooltip>
                                <strong>
                                    {{ pct(row.totalTokens / modelTokens) }} ·
                                    {{ short(row.totalTokens) }}
                                </strong>
                                <span class="source-model-bar">
                                    <span
                                        :style="{
                                            width: pct(
                                                row.totalTokens / modelTokens
                                            )
                                        }"
                                    ></span>
                                </span>
                            </div>
                        </div>

                        <div class="source-empty compact" v-else>
                            {{ busy ? '正在加载模型数据' : '暂无模型数据' }}
                        </div>
                    </div>
                </transition>
            </section>
        </div>

        <div class="source-empty" v-else>暂无 Token 数据</div>
    </aside>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import type { EChartsOption } from 'echarts'
import type { ChatLunaUsage } from 'koishi-plugin-chatluna-usage'
import { chartTheme } from '../theme'
import { fmt, pct, query, short, usage } from '../state'
import { escapeHtml } from '../charts/utils'

interface SourceClick {
    data: {
        key: string
    }
}

const active = ref('')
const busy = ref(false)
const modelTokens = ref(1)
const models = ref<ChatLunaUsage.Summary[]>([])
const VChart = defineAsyncComponent(() => import('../charts/echarts'))
let id = 0

const rows = computed(() =>
    (usage.value?.sources.filter((row) => row.totalTokens > 0) ?? []).sort(
        (a, b) => b.totalTokens - a.totalTokens
    )
)

const tokens = computed(() =>
    rows.value.reduce((sum, row) => sum + row.totalTokens, 0)
)

const title = computed(() =>
    sourceLabel(rows.value.find((row) => row.key === active.value)?.label)
)

function sourceLabel(label?: string) {
    if (!label) return ''
    if (label === 'chatluna') return label
    return label.startsWith('chatluna-')
        ? label.slice('chatluna-'.length)
        : label
}

const option = computed<EChartsOption>(() => {
    const theme = chartTheme.value

    return {
        color: [
            theme.brand,
            theme.success,
            theme.warning,
            theme.danger,
            theme.info,
            theme.muted
        ],
        tooltip: {
            trigger: 'item',
            formatter: (item) => {
                const row = item.data as {
                    calls: number
                    name: string
                    value: number
                }

                return [
                    escapeHtml(row.name),
                    `Token ${short(row.value)}`,
                    `调用 ${fmt(row.calls)}`,
                    `占比 ${pct(row.value / tokens.value)}`
                ].join('<br/>')
            },
            backgroundColor: theme.surface,
            borderColor: theme.border,
            textStyle: {
                color: theme.text
            }
        },
        series: [
            {
                name: '插件 Token',
                type: 'pie',
                radius: ['52%', '78%'],
                center: ['50%', '50%'],
                selectedMode: 'single',
                avoidLabelOverlap: true,
                itemStyle: {
                    borderColor: theme.surface,
                    borderRadius: 3,
                    borderWidth: 2
                },
                label: {
                    color: theme.muted,
                    formatter: '{b}',
                    overflow: 'truncate',
                    width: 88
                },
                labelLine: {
                    lineStyle: {
                        color: theme.border
                    }
                },
                emphasis: {
                    scale: true,
                    scaleSize: 6,
                    itemStyle: {
                        shadowBlur: 14,
                        shadowColor: 'rgba(0, 0, 0, 0.16)'
                    }
                },
                data: rows.value.map((row) => ({
                    calls: row.calls,
                    key: row.key,
                    name: sourceLabel(row.label),
                    selected: active.value === row.key,
                    value: row.totalTokens
                }))
            }
        ]
    }
})

watch(
    rows,
    () => {
        if (!rows.value.length) {
            active.value = ''
            return
        }

        if (!rows.value.some((row) => row.key === active.value)) {
            active.value = rows.value[0].key
        }
    },
    { immediate: true }
)

watch([active, usage], async () => {
    if (!active.value) {
        models.value = []
        modelTokens.value = 1
        return
    }

    const idx = ++id
    busy.value = true
    models.value = []

    try {
        const result = await send('chatluna-usage/query', {
            ...query,
            source: active.value,
            groupBy: 'model',
            sortBy: 'totalTokens',
            desc: true,
            page: 1
        })

        if (idx === id) {
            modelTokens.value = result.totals.totalTokens || 1
            models.value = result.groups.filter((row) => row.totalTokens > 0)
        }
    } catch {
        if (idx === id) ElMessage.error('查询插件模型用量失败')
    } finally {
        if (idx === id) busy.value = false
    }
})

function click(event: SourceClick) {
    active.value = event.data.key
}
</script>
