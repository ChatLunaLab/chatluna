import type * as echarts from 'echarts'
import { chartTheme } from '../theme'

export function escapeHtml(str: string) {
    return str
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

export const Tooltip = {
    axis<T = number>(
        formatter: (
            params: {
                marker?: string
                name: string
                value: T
                seriesName: string
            }[]
        ) => string,
        theme?: typeof chartTheme.value,
        pointer: 'cross' | 'shadow' = 'cross'
    ) {
        return {
            trigger: 'axis',
            axisPointer: {
                type: pointer
            },
            formatter,
            backgroundColor: theme?.surface,
            borderColor: theme?.border,
            textStyle: {
                color: theme?.text
            }
        } as unknown as echarts.TooltipComponentOption
    }
}
