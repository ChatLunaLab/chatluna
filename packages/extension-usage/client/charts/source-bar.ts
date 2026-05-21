import { Context } from '@koishijs/client'
import { createChart, Tooltip } from './utils'
import { selectSource } from '../state'

export default (ctx: Context) => {
    ctx.slot({
        type: 'chatluna-usage-chart',
        order: 70,
        component: createChart({
            title: '来源调用量排行',
            options({ chatluna_usage }) {
                const data = chatluna_usage.sources.slice(0, 12)
                if (!data.length) return

                return {
                    tooltip: Tooltip.axis<number>((params) =>
                        params
                            .map((item) => `${item.name}：${item.value}`)
                            .join('<br>')
                    ),
                    xAxis: {
                        type: 'value'
                    },
                    yAxis: {
                        type: 'category',
                        data: data.map((row) => row.key).reverse()
                    },
                    series: [
                        {
                            type: 'bar',
                            data: data.map((row) => row.calls).reverse()
                        }
                    ]
                }
            },
            click(event) {
                selectSource(event.name)
            }
        })
    })
}
