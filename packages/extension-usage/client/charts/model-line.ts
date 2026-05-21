import { Context } from '@koishijs/client'
import { createChart, Tooltip } from './utils'
import { selectModel } from '../state'

export default (ctx: Context) => {
    ctx.slot({
        type: 'chatluna-usage-chart',
        order: 80,
        component: createChart({
            title: '按模型调用次数',
            options({ chatluna_usage }) {
                const dates = chatluna_usage.timeline.map((row) => row.date)
                const models = chatluna_usage.models
                    .slice(0, 5)
                    .map((row) => row.key)
                if (!dates.length || !models.length) return

                return {
                    tooltip: Tooltip.axis<number>((params) =>
                        params
                            .map((item) => `${item.seriesName}：${item.value}`)
                            .join('<br>')
                    ),
                    legend: {
                        data: models
                    },
                    xAxis: {
                        type: 'category',
                        data: dates
                    },
                    yAxis: {
                        type: 'value'
                    },
                    series: chatluna_usage.modelTimeline
                        .filter((row) => models.includes(row.model))
                        .map((row) => {
                            const map = new Map(
                                row.points.map((point) => [
                                    point.date,
                                    point.calls
                                ])
                            )
                            return {
                                name: row.model,
                                type: 'line',
                                smooth: true,
                                data: dates.map((date) => map.get(date) ?? 0)
                            }
                        })
                }
            },
            click(event) {
                selectModel(event.seriesName)
            }
        })
    })
}
