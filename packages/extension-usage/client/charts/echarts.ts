import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import {
    GridComponent,
    LegendComponent,
    TooltipComponent
} from 'echarts/components'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import VChart from 'vue-echarts'

use([
    BarChart,
    CanvasRenderer,
    GridComponent,
    LegendComponent,
    LineChart,
    PieChart,
    TooltipComponent
])

export default VChart
