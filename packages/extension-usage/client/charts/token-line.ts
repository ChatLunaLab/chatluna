import {
    computed,
    defineAsyncComponent,
    defineComponent,
    h,
    ref,
    resolveComponent,
    watch
} from 'vue'
import { Context, send } from '@koishijs/client'
import { ElMessage } from 'element-plus'
import type { EChartsOption } from 'echarts'
import type { ChatLunaUsage } from 'koishi-plugin-chatluna-usage'
import { chartTheme } from '../theme'
import { query, usage } from '../state'
import { Tooltip } from './utils'

type Tab =
    | 'token-rank'
    | 'token-trend'
    | 'call-stack'
    | 'call-rank'
    | 'model-pie'
    | 'model-success'

interface Point {
    calls: number
    tokens: number
}

const VChart = defineAsyncComponent(() => import('./echarts'))
const ModelPie = defineAsyncComponent(() => import('./model-pie.vue'))
const ModelSuccess = defineAsyncComponent(() => import('./model-success.vue'))
const MAX_HOURS = 72

const tabs: { label: string; value: Tab }[] = [
    { label: '消耗历史', value: 'token-rank' },
    { label: '消耗趋势', value: 'token-trend' },
    { label: '调用历史', value: 'call-stack' },
    { label: '调用次数', value: 'call-rank' },
    { label: '模型分布', value: 'model-pie' },
    { label: '模型成功率', value: 'model-success' }
]

function hour(date: string | Date) {
    const value = new Date(date)
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    const hours = String(value.getHours()).padStart(2, '0')

    return `${year}-${month}-${day} ${hours}:00`
}

function escapeHtml(str: string) {
    return str
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

function tooltip(
    params: { marker?: string; seriesName: string; value: number }[],
    theme: typeof chartTheme.value,
    skipZero = false
) {
    const row =
        'display:flex;align-items:center;justify-content:space-between;' +
        'gap:1.5rem;min-width:12rem;line-height:1.7;'
    const name =
        'display:inline-flex;align-items:center;min-width:0;overflow:hidden;' +
        'text-overflow:ellipsis;white-space:nowrap;'
    const value =
        `margin-left:auto;color:${theme.brand};font-weight:700;` +
        'font-variant-numeric:tabular-nums;text-align:right;'

    return params
        .filter((item) => !skipZero || Number(item.value) > 0)
        .map(
            (item) =>
                `<div style="${row}">
                    <span style="${name}">${item.marker ?? ''}${escapeHtml(item.seriesName)}</span>
                    <strong style="${value}">${Number(item.value).toLocaleString()}</strong>
                </div>`
        )
        .join('')
}

export default (ctx: Context) => {
    ctx.slot({
        type: 'chatluna-usage-chart',
        order: 90,
        component: defineComponent({
            setup() {
                const tab = ref<Tab>('token-trend')
                const loading = ref(false)
                const rows = ref<ChatLunaUsage.Record[]>([])
                let id = 0

                const colors = computed(() => {
                    const theme = chartTheme.value

                    return [
                        theme.brand,
                        theme.success,
                        theme.warning,
                        theme.info,
                        theme.danger,
                        theme.muted
                    ]
                })

                const top = computed(() =>
                    (usage.value?.models ?? [])
                        .slice()
                        .sort((a, b) => b.totalTokens - a.totalTokens)
                        .slice(0, 6)
                )

                const color = computed(() => {
                    const map = new Map<string, string>()
                    const models = usage.value?.models ?? []

                    models
                        .slice()
                        .sort((a, b) => b.totalTokens - a.totalTokens)
                        .forEach((model, index) =>
                            map.set(
                                model.key,
                                colors.value[index % colors.value.length]
                            )
                        )

                    return map
                })

                const hourly = computed(() => {
                    const hours = new Set<string>()
                    const data = new Map<string, Map<string, Point>>()

                    for (const row of rows.value) {
                        const key = hour(row.createdAt)
                        const points = data.get(row.model) ?? new Map()
                        const point = points.get(key) ?? {
                            calls: 0,
                            tokens: 0
                        }

                        point.calls += 1
                        point.tokens += row.totalTokens
                        points.set(key, point)
                        data.set(row.model, points)
                        hours.add(key)
                    }

                    return {
                        data,
                        hours: [...hours].sort((a, b) => a.localeCompare(b))
                    }
                })

                const option = computed<EChartsOption | void>(() => {
                    const data = usage.value
                    if (!data) return
                    if (tab.value === 'model-pie') return
                    if (tab.value === 'model-success') return

                    const theme = chartTheme.value
                    const list = top.value
                    if (!list.length) return

                    const common = {
                        legend: {
                            type: 'scroll',
                            bottom: 30,
                            icon: 'rect',
                            itemWidth: 10,
                            itemHeight: 8,
                            textStyle: {
                                color: theme.muted
                            }
                        },
                        grid: {
                            top: 96,
                            right: 24,
                            bottom: 92,
                            left: 36,
                            containLabel: true
                        },
                        xAxis: {
                            type: 'category',
                            axisLabel: {
                                color: theme.muted,
                                hideOverlap: true
                            },
                            axisLine: {
                                lineStyle: {
                                    color: theme.border
                                }
                            },
                            axisTick: {
                                show: false
                            }
                        },
                        yAxis: {
                            type: 'value',
                            axisLabel: {
                                color: theme.muted
                            },
                            splitLine: {
                                lineStyle: {
                                    color: theme.grid
                                }
                            }
                        }
                    }

                    const hours = hourly.value.hours.slice(-MAX_HOURS)

                    if (tab.value === 'token-rank') {
                        if (!hours.length) return

                        return {
                            color: list.map(
                                (model, index) =>
                                    color.value.get(model.key) ??
                                    colors.value[index % colors.value.length]
                            ),
                            tooltip: Tooltip.axis<number>(
                                (params) => tooltip(params, theme),
                                theme,
                                'shadow'
                            ),
                            title: {
                                text: 'Token 消耗历史',
                                subtext: `总计：${data.totals.totalTokens.toLocaleString()}`,
                                left: 20,
                                top: 18,
                                textStyle: {
                                    color: theme.text,
                                    fontSize: 18,
                                    fontWeight: 700
                                },
                                subtextStyle: {
                                    color: theme.muted,
                                    fontSize: 14
                                }
                            },
                            ...common,
                            xAxis: {
                                ...common.xAxis,
                                data: hours
                            },
                            series: list.map((model) => {
                                const points =
                                    hourly.value.data.get(model.key) ??
                                    new Map()

                                return {
                                    name: model.label,
                                    type: 'bar',
                                    stack: 'tokens',
                                    barMaxWidth: 42,
                                    emphasis: {
                                        focus: 'series'
                                    },
                                    data: hours.map(
                                        (item) => points.get(item)?.tokens ?? 0
                                    )
                                }
                            })
                        }
                    }

                    if (tab.value === 'call-rank') {
                        const rank = data.models
                            .slice()
                            .sort((a, b) => b.calls - a.calls)
                            .slice(0, 10)

                        return {
                            color: rank.map(
                                (model, index) =>
                                    color.value.get(model.key) ??
                                    colors.value[index % colors.value.length]
                            ),
                            tooltip: Tooltip.axis<number>(
                                (params) => tooltip(params, theme, true),
                                theme,
                                'shadow'
                            ),
                            title: {
                                text: '调用次数排行',
                                subtext: `总计：${data.totals.calls.toLocaleString()}`,
                                left: 20,
                                top: 18,
                                textStyle: {
                                    color: theme.text,
                                    fontSize: 18,
                                    fontWeight: 700
                                },
                                subtextStyle: {
                                    color: theme.muted,
                                    fontSize: 14
                                }
                            },
                            legend: {
                                ...common.legend,
                                data: rank.map((model) => model.label)
                            },
                            grid: {
                                top: 96,
                                right: 24,
                                bottom: 92,
                                left: 36,
                                containLabel: true
                            },
                            xAxis: {
                                type: 'category',
                                data: rank.map((model) => model.label),
                                axisLabel: {
                                    color: theme.muted
                                },
                                axisLine: {
                                    lineStyle: {
                                        color: theme.border
                                    }
                                },
                                axisTick: {
                                    show: false
                                }
                            },
                            yAxis: common.yAxis,
                            series: rank.map((model, index) => ({
                                name: model.label,
                                type: 'bar',
                                stack: 'calls',
                                barMaxWidth: 72,
                                emphasis: {
                                    focus: 'series'
                                },
                                itemStyle: {
                                    color:
                                        color.value.get(model.key) ??
                                        colors.value[
                                            index % colors.value.length
                                        ],
                                    borderRadius: [6, 6, 0, 0]
                                },
                                data: rank.map((item) =>
                                    item.key === model.key ? model.calls : 0
                                )
                            }))
                        }
                    }

                    if (!hours.length) return

                    if (tab.value === 'call-stack') {
                        return {
                            color: list.map(
                                (model, index) =>
                                    color.value.get(model.key) ??
                                    colors.value[index % colors.value.length]
                            ),
                            tooltip: Tooltip.axis<number>(
                                (params) => tooltip(params, theme),
                                theme,
                                'shadow'
                            ),
                            title: {
                                text: '模型调用历史',
                                subtext: `总计：${data.totals.calls.toLocaleString()}`,
                                left: 20,
                                top: 18,
                                textStyle: {
                                    color: theme.text,
                                    fontSize: 18,
                                    fontWeight: 700
                                },
                                subtextStyle: {
                                    color: theme.muted,
                                    fontSize: 14
                                }
                            },
                            ...common,
                            xAxis: {
                                ...common.xAxis,
                                data: hours
                            },
                            series: list.map((model) => {
                                const points =
                                    hourly.value.data.get(model.key) ??
                                    new Map()

                                return {
                                    name: model.label,
                                    type: 'bar',
                                    stack: 'calls',
                                    barMaxWidth: 42,
                                    emphasis: {
                                        focus: 'series'
                                    },
                                    data: hours.map(
                                        (item) => points.get(item)?.calls ?? 0
                                    )
                                }
                            })
                        }
                    }

                    return {
                        color: list.map(
                            (model, index) =>
                                color.value.get(model.key) ??
                                colors.value[index % colors.value.length]
                        ),
                        tooltip: Tooltip.axis<number>(
                            (params) => tooltip(params, theme),
                            theme
                        ),
                        title: {
                            text: 'Token 消耗趋势',
                            subtext: `总计：${data.totals.totalTokens.toLocaleString()}`,
                            left: 20,
                            top: 18,
                            textStyle: {
                                color: theme.text,
                                fontSize: 18,
                                fontWeight: 700
                            },
                            subtextStyle: {
                                color: theme.muted,
                                fontSize: 14
                            }
                        },
                        ...common,
                        xAxis: {
                            ...common.xAxis,
                            data: hours
                        },
                        series: list.map((model) => {
                            const points =
                                hourly.value.data.get(model.key) ?? new Map()

                            return {
                                name: model.label,
                                type: 'line',
                                smooth: false,
                                showSymbol: true,
                                symbol: 'circle',
                                symbolSize: 6,
                                lineStyle: {
                                    width: 2.5
                                },
                                emphasis: {
                                    focus: 'series'
                                },
                                data: hours.map(
                                    (item) => points.get(item)?.tokens ?? 0
                                )
                            }
                        })
                    }
                })

                watch(
                    usage,
                    async () => {
                        if (!usage.value) {
                            rows.value = []
                            return
                        }

                        const idx = ++id
                        const result: ChatLunaUsage.Record[] = []
                        let page = 1
                        loading.value = true
                        rows.value = []

                        try {
                            while (true) {
                                const list = await send('chatluna-usage/list', {
                                    ...query,
                                    page,
                                    pageSize: 1000
                                })

                                result.push(...list.rows)
                                if (
                                    result.length >= list.total ||
                                    !list.rows.length
                                ) {
                                    break
                                }
                                page += 1
                            }

                            if (idx === id) rows.value = result
                        } catch {
                            if (idx === id) ElMessage.error('查询模型趋势失败')
                        } finally {
                            if (idx === id) loading.value = false
                        }
                    },
                    { immediate: true }
                )

                return () => {
                    const current = option.value

                    return h(
                        resolveComponent('k-card'),
                        { class: 'frameless chatluna-usage-chart' },
                        {
                            header: () =>
                                h('div', { class: 'chart-heading' }, [
                                    h('span', { class: 'chart-title' }, [
                                        h(
                                            'svg',
                                            {
                                                class: 'chart-title-icon',
                                                xmlns: 'http://www.w3.org/2000/svg',
                                                viewBox: '0 0 24 24',
                                                fill: 'none',
                                                'aria-hidden': 'true'
                                            },
                                            [
                                                h('path', {
                                                    d: 'M4 19V5',
                                                    stroke: 'currentColor',
                                                    'stroke-width': '2',
                                                    'stroke-linecap': 'round'
                                                }),
                                                h('path', {
                                                    d: 'M4 19h16',
                                                    stroke: 'currentColor',
                                                    'stroke-width': '2',
                                                    'stroke-linecap': 'round'
                                                }),
                                                h('path', {
                                                    d: 'M7 15l3-4 3 2 4-6',
                                                    stroke: 'currentColor',
                                                    'stroke-width': '2.2',
                                                    'stroke-linecap': 'round',
                                                    'stroke-linejoin': 'round'
                                                })
                                            ]
                                        ),
                                        '模型数据分析'
                                    ]),
                                    h(
                                        'nav',
                                        { class: 'chart-tabs' },
                                        tabs.map((item, index) => [
                                            index
                                                ? h(
                                                      'span',
                                                      {
                                                          class: 'chart-tab-sep'
                                                      },
                                                      '/'
                                                  )
                                                : null,
                                            h(
                                                'button',
                                                {
                                                    class: {
                                                        active:
                                                            tab.value ===
                                                            item.value
                                                    },
                                                    type: 'button',
                                                    onClick: () =>
                                                        (tab.value = item.value)
                                                },
                                                item.label
                                            )
                                        ])
                                    )
                                ]),
                            default: () => {
                                if (tab.value === 'model-pie') {
                                    return h(ModelPie, {
                                        key: `${chartTheme.value.key}-model-pie`
                                    })
                                }
                                if (tab.value === 'model-success') {
                                    return h(ModelSuccess, {
                                        key: `${chartTheme.value.key}-model-success`
                                    })
                                }
                                return current
                                    ? h(VChart, {
                                          key: `${chartTheme.value.key}-${tab.value}-${rows.value.length}`,
                                          option: current,
                                          autoresize: true
                                      })
                                    : h('div', { class: 'chart-empty' }, [
                                          loading.value
                                              ? '正在加载小时级数据'
                                              : '暂无用量数据'
                                      ])
                            }
                        }
                    )
                }
            }
        })
    })
}
