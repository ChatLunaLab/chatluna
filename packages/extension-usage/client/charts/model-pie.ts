import { Context } from '@koishijs/client'
import { createChart, Tooltip } from './utils'
import { selectModel } from '../state'

export default (ctx: Context) => {
    ctx.slot({
        type: 'chatluna-usage-chart',
        order: 100,
        component: createChart({
            title: '模型调用量占比',
            options({ chatluna_usage }) {
                const data = chatluna_usage.models
                    .slice(0, 10)
                    .map((row) => ({ name: row.key, value: row.calls }))
                if (!data.length) return

                return {
                    tooltip: Tooltip.item(({ data }) =>
                        [`模型：${data.name}`, `调用：${data.value}`].join(
                            '<br>'
                        )
                    ),
                    series: [
                        {
                            type: 'pie',
                            data,
                            radius: ['35%', '65%'],
                            minShowLabelAngle: 3
                        }
                    ]
                }
            },
            click(event) {
                selectModel(event.data.name)
            }
        })
    })
}
