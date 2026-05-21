import { defineAsyncComponent, defineComponent, h, resolveComponent } from 'vue'
import { Store, store } from '@koishijs/client'
import type * as echarts from 'echarts'
import './index.scss'

const VChart = defineAsyncComponent(() => import('./echarts'))

interface ChartClickEvent {
    name: string
    seriesName: string
    data: {
        name: string
    }
}

export interface ChartOptions {
    title: string
    options: (store: Store) => echarts.EChartsOption
    click?: (event: ChartClickEvent) => void
}

export function createChart({ title, options, click }: ChartOptions) {
    return defineComponent({
        render: () => {
            const option = store.chatluna_usage ? options(store) : undefined
            return h(
                resolveComponent('k-card'),
                { class: 'frameless chatluna-usage-chart' },
                {
                    header: () => h('span', { class: 'left' }, [title]),
                    default: () =>
                        option
                            ? h(VChart, {
                                  option,
                                  autoresize: true,
                                  onClick: click
                                      ? (event: unknown) =>
                                            click(event as ChartClickEvent)
                                      : undefined
                              })
                            : h('div', { class: 'chart-empty' }, [
                                  store.chatluna_usage
                                      ? '暂无用量数据'
                                      : '正在加载用量数据'
                              ])
                }
            )
        }
    })
}

export const Tooltip = {
    item<T = { name: string; value: number }>(
        formatter: (params: { data: T; name: string; value: number }) => string
    ) {
        return {
            trigger: 'item',
            formatter
        } as unknown as echarts.TooltipComponentOption
    },

    axis<T = number>(
        formatter: (
            params: { name: string; value: T; seriesName: string }[]
        ) => string
    ) {
        return {
            trigger: 'axis',
            axisPointer: {
                type: 'cross'
            },
            formatter
        } as unknown as echarts.TooltipComponentOption
    }
}
