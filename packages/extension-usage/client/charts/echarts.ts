import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import {
    GridComponent,
    LegendComponent,
    TitleComponent,
    TooltipComponent
} from 'echarts/components'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import vChart from 'vue-echarts'

use([
    BarChart,
    CanvasRenderer,
    GridComponent,
    LegendComponent,
    LineChart,
    PieChart,
    TitleComponent,
    TooltipComponent
])

export default vChart
