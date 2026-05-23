<template>
    <div class="model-pie-panel" v-if="rows.length && tokens">
        <div class="model-chart-title">
            <h3>模型消耗分布</h3>
            <p>总计：{{ fmt(tokens) }} Tokens</p>
        </div>

        <div class="model-pie-body">
            <v-chart class="model-pie-chart" :option="option" autoresize />

            <el-table
                class="model-pie-table"
                :data="rows"
                :default-sort="{ prop: 'totalTokens', order: 'descending' }"
                height="100%"
                stripe
                size="small"
            >
                <el-table-column
                    prop="label"
                    label="模型"
                    min-width="180"
                    sortable
                >
                    <template #default="scope">
                        <span class="model-pie-cell">
                            <span
                                class="model-pie-dot"
                                :style="{
                                    background: dotColor(
                                        rows.findIndex(
                                            (r) => r.key === scope.row.key
                                        )
                                    )
                                }"
                            ></span>
                            <el-tooltip
                                :content="
                                    scope.row.platform
                                        ? `${scope.row.platform}/${scope.row.label}`
                                        : scope.row.label
                                "
                                placement="top"
                                effect="dark"
                            >
                                <span class="model-pie-name">
                                    {{ scope.row.label }}
                                </span>
                            </el-tooltip>
                        </span>
                    </template>
                </el-table-column>
                <el-table-column
                    prop="calls"
                    label="请求"
                    width="90"
                    align="right"
                    sortable
                >
                    <template #default="scope">
                        {{ fmt(scope.row.calls) }}
                    </template>
                </el-table-column>
                <el-table-column
                    prop="totalTokens"
                    label="Token"
                    width="110"
                    align="right"
                    sortable
                >
                    <template #default="scope">
                        {{ short(scope.row.totalTokens) }}
                    </template>
                </el-table-column>
            </el-table>
        </div>
    </div>

    <div class="chart-empty" v-else>暂无模型数据</div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import type { EChartsOption } from 'echarts'
import { chartTheme } from '../theme'
import { fmt, pct, short, usage } from '../state'
import { escapeHtml } from './utils'

const VChart = defineAsyncComponent(() => import('./echarts'))

const palette = computed(() => {
    const t = chartTheme.value
    return [t.brand, t.success, t.warning, t.danger, t.info, t.muted]
})

function dotColor(idx: number) {
    const colors = palette.value
    return colors[idx % colors.length]
}

const rows = computed(() =>
    (usage.value?.models.filter((row) => row.totalTokens > 0) ?? [])
        .slice()
        .sort((a, b) => b.totalTokens - a.totalTokens)
)

const tokens = computed(() =>
    rows.value.reduce((sum, row) => sum + row.totalTokens, 0)
)

const option = computed<EChartsOption>(() => {
    const theme = chartTheme.value

    return {
        color: palette.value,
        tooltip: {
            trigger: 'item',
            appendToBody: true,
            position: (point, _params, _dom, _rect, size) => {
                const gap = 12
                const view = size.viewSize
                const content = size.contentSize
                let x = point[0] + gap
                let y = point[1] + gap

                if (x + content[0] > view[0]) {
                    x = point[0] - content[0] - gap
                }
                if (y + content[1] > view[1]) {
                    y = point[1] - content[1] - gap
                }

                return [Math.max(gap, x), Math.max(gap, y)]
            },
            formatter: (item) => {
                const row = item.data as {
                    calls: number
                    name: string
                    value: number
                }
                return [
                    escapeHtml(row.name),
                    `Token ${fmt(row.value)}`,
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
                name: '模型 Token',
                type: 'pie',
                radius: ['32%', '60%'],
                center: ['50%', '40%'],
                avoidLabelOverlap: true,
                itemStyle: {
                    borderColor: theme.surface,
                    borderRadius: 6,
                    borderWidth: 3
                },
                label: { show: false },
                labelLine: { show: false },
                emphasis: {
                    scale: true,
                    scaleSize: 5,
                    itemStyle: {
                        shadowBlur: 14,
                        shadowColor: 'rgba(0, 0, 0, 0.14)'
                    }
                },
                data: rows.value.map((row) => ({
                    calls: row.calls,
                    key: row.key,
                    name: row.label,
                    value: row.totalTokens
                }))
            }
        ]
    }
})
</script>

<style lang="scss">
.model-pie-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 1.25rem;
    height: 460px;
    box-sizing: border-box;
    padding: 18px 20px 16px;
}

.model-pie-body {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr);
    align-items: stretch;
    gap: 1.5rem;
    min-height: 0;
}

.model-pie-chart {
    place-self: center;
    width: min(100%, 260px);
    height: min(100%, 260px);
    min-width: 200px;
    min-height: 200px;
}

.model-pie-table.el-table {
    --el-table-bg-color: transparent;
    --el-table-tr-bg-color: transparent;
    --el-table-header-bg-color: transparent;
    --el-table-row-hover-bg-color: var(--k-hover-bg);
    --el-table-border-color: var(--k-card-border);
    --el-fill-color-lighter: color-mix(
        in srgb,
        var(--k-card-bg),
        var(--k-color-divider) 32%
    );
    color: var(--k-text-dark);
    background: transparent;

    &::before {
        display: none;
    }
}

.model-pie-table.el-table th.el-table__cell {
    background-color: transparent;
    color: var(--k-text-light);
    font-weight: 500;
    font-size: 0.8rem;
}

.model-pie-table.el-table td.el-table__cell {
    background-color: transparent;
    font-size: 0.85rem;
    padding: 0.4rem 0;
}

.model-pie-table.el-table--striped
    .el-table__body
    tr.el-table__row--striped
    td.el-table__cell {
    background-color: var(--el-fill-color-lighter);
}

.model-pie-table.el-table--enable-row-hover
    .el-table__body
    tr:hover
    > td.el-table__cell {
    background-color: var(--el-table-row-hover-bg-color);
}

.model-pie-cell {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    max-width: 100%;
}

.model-pie-dot {
    width: 0.5rem;
    height: 0.5rem;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--k-color-primary);
}

.model-pie-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

@media (max-width: 768px) {
    .model-pie-body {
        grid-template-columns: 1fr;
        grid-template-rows: 220px minmax(0, 1fr);
    }

    .model-pie-chart {
        width: min(100%, 220px);
        height: 220px;
    }
}
</style>
