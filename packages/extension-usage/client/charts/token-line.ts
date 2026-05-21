import { Context } from '@koishijs/client'
import { createChart, Tooltip } from './utils'

export default (ctx: Context) => {
    ctx.slot({
        type: 'chatluna-usage-chart',
        order: 90,
        component: createChart({
            title: 'Token 折线',
            options({ chatluna_usage }) {
                if (!chatluna_usage.timeline.length) return

                return {
                    tooltip: Tooltip.axis<number>((params) =>
                        params
                            .map((item) => `${item.seriesName}：${item.value}`)
                            .join('<br>')
                    ),
                    legend: {
                        data: ['输入', '输出', '总量']
                    },
                    xAxis: {
                        type: 'category',
                        data: chatluna_usage.timeline.map((row) => row.date)
                    },
                    yAxis: {
                        type: 'value'
                    },
                    series: [
                        {
                            name: '输入',
                            type: 'line',
                            smooth: true,
                            data: chatluna_usage.timeline.map(
                                (row) => row.inputTokens
                            )
                        },
                        {
                            name: '输出',
                            type: 'line',
                            smooth: true,
                            data: chatluna_usage.timeline.map(
                                (row) => row.outputTokens
                            )
                        },
                        {
                            name: '总量',
                            type: 'line',
                            smooth: true,
                            data: chatluna_usage.timeline.map(
                                (row) => row.totalTokens
                            )
                        }
                    ]
                }
            }
        })
    })
}
