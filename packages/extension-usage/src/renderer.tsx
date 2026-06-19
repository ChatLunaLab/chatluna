import type { Context } from 'koishi'
import type {} from 'koishi-plugin-puppeteer'
import { formatDate } from './tokens'
import type { ChatLunaUsage } from './utils'

interface Coord {
    x: number
    y: number
    point: ChatLunaUsage.TokenPoint
}

type RenderTheme = Exclude<ChatLunaUsage.TokenTheme, 'auto'>

const CSS = `
:root {
    --bg-paper: #f8fafc;
    --bg-paper-soft: #f1f5f9;
    --bg-paper-row: #e2e8f0;
    --bg-paper-line: rgba(148, 163, 184, 0.025);
    --bg-paper-dot: rgba(255, 255, 255, 0.65);
    --bg-paper-glow: rgba(255, 255, 255, 0.72);
    --bg-legend: rgba(241, 245, 249, 0.78);
    --bg-row: rgba(241, 245, 249, 0.78);
    --bg-row-hover: rgba(148, 163, 184, 0.05);
    --bg-row-track: #e2e8f0;
    --text-primary: #0f172a;
    --text-secondary: #475569;
    --text-muted: #64748b;
    --border-color: #cbd5e1;
    --grid-line: #e2e8f0;
    --color-total: #7e1671;
    --color-input: #1772b4;
    --color-output: #20894d;
    --edge-shade: rgba(148, 163, 184, 0.08);
    --row-border: rgba(203, 213, 225, 0.42);
    --legend-border: rgba(203, 213, 225, 0.62);
    --bar-shadow: transparent;
    --shadow-paper: none;
    --shadow-lift: none;
    --shadow-hover: none;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color-scheme: light;
}

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: transparent;
}

.stage {
    position: relative;
    display: inline-block;
    width: 1000px;
    padding: 32px 38px 34px;
    background: var(--bg-paper);
    color: var(--text-primary);
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Noto Sans SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
}

.stage.theme-dark {
    --bg-paper: #1e293b;
    --bg-paper-soft: #334155;
    --bg-paper-row: #1e293b;
    --bg-paper-line: rgba(255, 255, 255, 0.015);
    --bg-paper-dot: rgba(255, 255, 255, 0.02);
    --bg-paper-glow: rgba(255, 255, 255, 0.03);
    --bg-legend: rgba(51, 65, 85, 0.88);
    --bg-row: rgba(30, 41, 59, 0.86);
    --bg-row-hover: rgba(255, 255, 255, 0.03);
    --bg-row-track: #334155;
    --text-primary: #f8fafc;
    --text-secondary: #cbd5e1;
    --text-muted: #94a3b8;
    --border-color: #475569;
    --grid-line: #334155;
    --color-total: #c8709c;
    --color-input: #4a9eda;
    --color-output: #4ade80;
    --edge-shade: rgba(255, 255, 255, 0.03);
    --row-border: rgba(71, 85, 105, 0.44);
    --legend-border: rgba(71, 85, 105, 0.55);
    --bar-shadow: transparent;
    --shadow-paper: none;
    --shadow-lift: none;
    --shadow-hover: none;
    color-scheme: dark;
}

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: transparent;
}

.stage {
    position: relative;
    display: inline-block;
    width: 1000px;
    padding: 32px 38px 34px;
    background: var(--bg-paper);
    color: var(--text-primary);
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Noto Sans SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
}

.stage::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
}

.paper-content {
    position: relative;
    z-index: 1;
}

.hero-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 24px;
}

.hero-title {
    margin: 0;
    font-size: 28px;
    line-height: 1.18;
    font-weight: 800;
    letter-spacing: 0;
    color: var(--text-primary);
}

.time-strip {
    display: inline-grid;
    grid-template-columns: auto auto auto auto;
    align-items: center;
    gap: 8px;
    padding: 10px 15px;
    background: var(--bg-paper-soft);
    border-radius: 10px;
    transform: rotate(0.35deg);
}

.time-label {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 700;
}

.time-value,
.time-sep {
    color: var(--text-secondary);
    font-size: 13px;
    font-family: var(--font-mono);
    font-weight: 700;
    font-style: normal;
}

.stats-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin-bottom: 24px;
}

.stat-cell {
    padding: 0 20px;
}

.stat-cell:first-child {
    padding-left: 0;
}

.stat-cell + .stat-cell {
    border-left: 1px solid var(--edge-shade);
}

.stat-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

.stat-value {
    margin-top: 6px;
    font-size: 22px;
    font-weight: 700;
    font-family: var(--font-mono);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
}

.chart-container {
    padding: 22px 0 18px;
    margin: 4px 0 2px;
    background: transparent;
}

.trend-chart {
    display: block;
    width: 100%;
    height: auto;
}

.grid line {
    stroke: var(--grid-line);
    stroke-width: 1;
    stroke-dasharray: 3 3;
}

.grid text {
    fill: var(--text-secondary);
    font-size: 11px;
    font-family: var(--font-mono);
    text-anchor: end;
    font-weight: 500;
}

.axis-x {
    fill: var(--text-secondary);
    font-size: 11px;
    font-family: var(--font-mono);
    text-anchor: middle;
    font-weight: 500;
}

.line {
    fill: none;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.line-total {
    stroke: var(--color-total);
}

.line-input {
    stroke: var(--color-input);
}

.line-output {
    stroke: var(--color-output);
}

.line-input {
    stroke: var(--color-input);
}

.line-output {
    stroke: var(--color-output);
}

.bar-outline {
    stroke: var(--row-border);
}

.dot-input {
    fill: var(--bg-paper);
    stroke-width: 2;
    stroke: var(--color-input);
}

.dot-output {
    fill: var(--bg-paper);
    stroke-width: 2;
    stroke: var(--color-output);
}

.dot-last.dot-total {
    fill: var(--color-total);
    stroke: var(--bg-paper);
}

.bar-outline {
    stroke: var(--row-border);
}

.chart-legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 12px;
}

.legend-item {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    background: var(--bg-legend);
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
}

.legend-color-indicator {
    display: inline-block;
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--legend-color);
    margin-right: 8px;
    font-size: 0;
    line-height: 0;
}

.legend-total-indicator {
    border-radius: 50%;
}

.empty-chart {
    display: grid;
    height: 320px;
    place-items: center;
    color: var(--text-muted);
    font-size: 14px;
    border-radius: 8px;
}

.plugin-section {
    margin-top: 28px;
    padding-top: 24px;
    border-top: 2px dashed rgba(180, 135, 82, 0.38);
}

.section-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
}

.section-title-row h2 {
    margin: 0;
    font-size: 22px;
    line-height: 1.2;
    color: var(--text-primary);
}

.sort-chip {
    padding: 7px 12px;
    color: var(--text-secondary);
    background: var(--bg-paper-soft);
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
}

.plugin-list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--bg-row);
    border-radius: 8px;
    overflow: hidden;
}

.plugin-list-head,
.plugin-list-row {
    display: grid;
    grid-template-columns: 1fr 240px 160px 120px;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
}

.plugin-list-head {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
}

.plugin-list-row {
    font-size: 13px;
    color: var(--text-primary);
    background: transparent;
    transition: background 180ms ease;
}

.plugin-list-row + .plugin-list-row {
    margin-top: 0;
    border-top: 1px solid var(--row-border);
}

.plugin-list-row:hover {
    background: var(--bg-row-hover);
}

.plugin-name-cell {
    font-weight: 500;
    display: flex;
    align-items: center;
}

.plugin-indicator {
    display: inline-block;
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    margin-right: 10px;
    font-size: 0;
    line-height: 0;
}

.plugin-progress-wrapper {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
}

.plugin-progress-bar {
    flex: 1;
    height: 5px;
    border-radius: 3px;
    background: var(--bg-row-track);
    overflow: hidden;
}

.plugin-progress-fill {
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
    font-size: 0;
    line-height: 0;
}

.plugin-number {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
}

.text-right {
    text-align: right !important;
}

.text-center {
    text-align: center !important;
}

.footer {
    margin-top: 28px;
    padding-top: 16px;
    border-top: 1px solid var(--edge-shade);
    text-align: center;
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 500;
}

.footer span {
    font-weight: 700;
    color: var(--text-secondary);
}
`

const MODEL_COLORS = [
    '#b14b28',
    '#1772b4',
    '#20894d',
    '#ebb10d',
    '#813c85',
    '#fb8b05',
    '#12aa9c',
    '#eb261a',
    '#918072'
]

const CHART = {
    width: 952,
    height: 320,
    left: 60,
    right: 20,
    top: 20,
    bottom: 48,
    gridLines: 5,
    maxLabels: 30,
    maxModels: 5,
    minBarWidth: 3,
    maxBarWidth: 28
} as const

const CURVE_FACTOR = 0.4
const FLAT_Y_THRESHOLD = 0.1
const MAX_PLUGIN_ROWS = 6
const OTHER_COLOR = '#94a3b8'
const OTHER_MODEL_NAME = '其他模型'
const OTHER_PLUGIN_NAME = '其他插件'

function formatNum(value: number) {
    if (value >= 1000000) {
        return (value / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
    }
    if (value >= 1000) {
        return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
    }
    return value.toString()
}

function monotonePath(pts: Coord[]) {
    const n = pts.length
    if (n < 2) return ''
    if (n === 2) {
        return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`
    }

    const h = new Array(n - 1)
    const m = new Array(n - 1)
    for (let i = 0; i < n - 1; i++) {
        h[i] = pts[i + 1].x - pts[i].x
        m[i] = (pts[i + 1].y - pts[i].y) / h[i]
    }

    const t = new Array(n)

    t[0] = m[0]
    t[n - 1] = m[n - 2]

    for (let i = 1; i < n - 1; i++) {
        const s0 = m[i - 1]
        const s1 = m[i]

        if (s0 * s1 <= 0) {
            t[i] = 0
        } else {
            const h0 = h[i - 1]
            const h1 = h[i]
            const p = (s0 * h1 + s1 * h0) / (h0 + h1)
            t[i] =
                (Math.sign(s0) + Math.sign(s1)) *
                Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p))
        }
    }

    t[0] = Math.sign(m[0]) * Math.min(Math.abs(m[0]), Math.abs(t[0]))
    t[n - 1] =
        Math.sign(m[n - 2]) * Math.min(Math.abs(m[n - 2]), Math.abs(t[n - 1]))

    const maxY = Math.max(...pts.map((p) => p.y))

    let d = `M${pts[0].x},${pts[0].y}`
    for (let i = 0; i < n - 1; i++) {
        const dx = h[i]

        const c1x = pts[i].x + dx * CURVE_FACTOR
        let c1y = pts[i].y + t[i] * dx * CURVE_FACTOR
        const c2x = pts[i + 1].x - dx * CURVE_FACTOR
        let c2y = pts[i + 1].y - t[i + 1] * dx * CURVE_FACTOR

        if (Math.abs(pts[i].y - pts[i + 1].y) < FLAT_Y_THRESHOLD) {
            c1y = pts[i].y
            c2y = pts[i + 1].y
        } else if (pts[i].y < pts[i + 1].y) {
            c1y = Math.max(pts[i].y, Math.min(pts[i + 1].y, c1y))
            c2y = Math.max(pts[i].y, Math.min(pts[i + 1].y, c2y))
        } else {
            c1y = Math.max(pts[i + 1].y, Math.min(pts[i].y, c1y))
            c2y = Math.max(pts[i + 1].y, Math.min(pts[i].y, c2y))
        }

        c1y = Math.min(maxY, c1y)
        c2y = Math.min(maxY, c2y)

        d += ` C${c1x},${c1y} ${c2x},${c2y} ${pts[i + 1].x},${pts[i + 1].y}`
    }
    return d
}

function getTopModels(points: ChatLunaUsage.TokenPoint[]) {
    const modelTotals: Record<string, number> = {}
    for (const p of points) {
        for (const [model, val] of Object.entries(p.models)) {
            modelTotals[model] = (modelTotals[model] || 0) + val
        }
    }
    const sortedModels = Object.entries(modelTotals)
        .sort((a, b) => b[1] - a[1])
        .map(([model]) => model)

    const topModels = sortedModels.slice(0, CHART.maxModels)

    const colorMap: Record<string, string> = {}
    topModels.forEach((model, i) => {
        colorMap[model] = MODEL_COLORS[i % MODEL_COLORS.length]
    })
    if (sortedModels.length > CHART.maxModels) {
        colorMap[OTHER_MODEL_NAME] = OTHER_COLOR
    }
    return { topModels, colorMap }
}

type ModelInfo = ReturnType<typeof getTopModels>

function getChartLayout(points: ChatLunaUsage.TokenPoint[]) {
    const plotWidth = CHART.width - CHART.left - CHART.right
    const plotHeight = CHART.height - CHART.top - CHART.bottom
    const baseline = CHART.top + plotHeight
    const max = Math.max(
        1,
        ...points.map((p) => p.tokens),
        ...points.map((p) => p.inputTokens),
        ...points.map((p) => p.outputTokens)
    )
    const stepX =
        points.length > 1 ? plotWidth / (points.length - 1) : plotWidth
    const barWidth = Math.max(
        CHART.minBarWidth,
        Math.min(CHART.maxBarWidth, stepX * 0.5)
    )
    const safePadding = barWidth / 2 + 4
    const drawWidth = plotWidth - safePadding * 2

    const makeCoords = (key: keyof ChatLunaUsage.TokenPoint) =>
        points.map((point, idx) => ({
            x:
                points.length === 1
                    ? CHART.left + plotWidth / 2
                    : CHART.left +
                      safePadding +
                      (drawWidth * idx) / (points.length - 1),
            y: baseline - ((point[key] as number) / max) * plotHeight,
            point
        }))

    const totalCoords = makeCoords('tokens')
    const inputCoords = makeCoords('inputTokens')
    const outputCoords = makeCoords('outputTokens')

    return {
        plotWidth,
        plotHeight,
        baseline,
        max,
        barWidth,
        safePadding,
        drawWidth,
        totalCoords,
        totalLine: monotonePath(totalCoords),
        inputCoords,
        inputLine: monotonePath(inputCoords),
        outputCoords,
        outputLine: monotonePath(outputCoords),
        stepLabel: Math.max(1, Math.ceil(points.length / CHART.maxLabels))
    }
}

type ChartLayout = ReturnType<typeof getChartLayout>

function getBarItems(point: ChatLunaUsage.TokenPoint, info: ModelInfo) {
    const items: { name: string; val: number }[] = []
    let otherVal = 0

    for (const [name, val] of Object.entries(point.models)) {
        if (val <= 0) continue
        if (info.topModels.includes(name)) {
            items.push({ name, val })
        } else {
            otherVal += val
        }
    }

    items.sort(
        (a, b) =>
            info.topModels.indexOf(a.name) - info.topModels.indexOf(b.name)
    )

    if (otherVal > 0) {
        items.push({ name: OTHER_MODEL_NAME, val: otherVal })
    }

    return items
}

function renderGrid(layout: ChartLayout) {
    const last = CHART.gridLines - 1

    return (
        <g class="grid">
            {Array.from({ length: CHART.gridLines }, (_, idx) => {
                const y = CHART.top + (layout.plotHeight * idx) / last
                const value = Math.round(layout.max - (layout.max * idx) / last)
                return [
                    <line
                        x1={CHART.left}
                        y1={y}
                        x2={CHART.width - CHART.right}
                        y2={y}
                    />,
                    <text x={CHART.left - 12} y={y + 4}>
                        {formatNum(value)}
                    </text>
                ]
            })}
        </g>
    )
}

function renderBars(
    points: ChatLunaUsage.TokenPoint[],
    info: ModelInfo,
    layout: ChartLayout
) {
    return points.map((point, idx) => {
        const x =
            points.length === 1
                ? CHART.left + layout.plotWidth / 2
                : CHART.left +
                  layout.safePadding +
                  (layout.drawWidth * idx) / (points.length - 1)
        const items = getBarItems(point, info)
        let currentY = layout.baseline
        const groupHeight = items.reduce(
            (sum, item) => sum + (item.val / layout.max) * layout.plotHeight,
            0
        )
        const groupY = layout.baseline - groupHeight

        return (
            <g>
                {items.map((item) => {
                    const barHeight =
                        (item.val / layout.max) * layout.plotHeight
                    const y = currentY - barHeight
                    currentY = y
                    return (
                        <rect
                            class="bar-piece"
                            x={x - layout.barWidth / 2}
                            y={y}
                            width={layout.barWidth}
                            height={barHeight}
                            fill={info.colorMap[item.name]}
                            opacity="0.85"
                        />
                    )
                })}
                {groupHeight > 0 && (
                    <rect
                        class="bar-outline"
                        x={x - layout.barWidth / 2}
                        y={groupY}
                        width={layout.barWidth}
                        height={groupHeight}
                        fill="none"
                        stroke-width="1"
                        opacity="0.6"
                    />
                )}
            </g>
        )
    })
}

function renderAxisLabels(coords: Coord[], stepLabel: number) {
    return coords.map((c, idx) => {
        const shouldShowLabel =
            idx === 0 || idx === coords.length - 1 || idx % stepLabel === 0
        if (!shouldShowLabel) return null

        const parts = c.point.label.split(' ')
        return (
            <text
                class="axis-x"
                x={c.x}
                y={CHART.height - (parts[1] ? 22 : 18)}
            >
                {parts[1]
                    ? parts.map((part, pIdx) => (
                          <tspan x={c.x} dy={pIdx ? '13' : '0'}>
                              {part}
                          </tspan>
                      ))
                    : c.point.label}
            </text>
        )
    })
}

function chart(
    points: ChatLunaUsage.TokenPoint[],
    info: ModelInfo,
    mode: ChatLunaUsage.TokenRenderMode = 'both'
) {
    if (!points.length) return <div class="empty-chart">暂无用量数据</div>

    const layout = getChartLayout(points)
    const showLine = mode === 'both' || mode === 'line'
    const showBar = mode === 'both' || mode === 'bar'

    return (
        <svg
            class="trend-chart"
            viewbox={`0 0 ${CHART.width} ${CHART.height}`}
            role="img"
        >
            {renderGrid(layout)}
            {showBar ? renderBars(points, info, layout) : null}
            {showLine && layout.totalLine ? (
                <path class="line line-total" d={layout.totalLine} />
            ) : null}
            {mode === 'line' && layout.inputLine ? (
                <path class="line line-input" d={layout.inputLine} />
            ) : null}
            {mode === 'line' && layout.outputLine ? (
                <path class="line line-output" d={layout.outputLine} />
            ) : null}
            {renderAxisLabels(layout.totalCoords, layout.stepLabel)}
        </svg>
    )
}

function pluginSection(plugins?: ChatLunaUsage.TokenReport['plugins']) {
    if (!plugins?.length) return ''

    const total = plugins.reduce((sum, p) => sum + p.tokens, 0) || 1

    let displayPlugins = plugins.slice(0, MAX_PLUGIN_ROWS)
    if (plugins.length > MAX_PLUGIN_ROWS) {
        const other = {
            source: OTHER_PLUGIN_NAME,
            tokens: 0,
            calls: 0
        }
        for (const p of plugins.slice(MAX_PLUGIN_ROWS)) {
            other.tokens += p.tokens
            other.calls += p.calls
        }
        displayPlugins = [...displayPlugins, other]
    }

    return (
        <section class="plugin-section">
            <div class="section-title-row">
                <h2>用量明细</h2>
                <span class="sort-chip">按 Token 使用降序排列</span>
            </div>
            <div class="plugin-list-head">
                <span>来源插件</span>
                <span class="text-center">用量占比</span>
                <span class="text-right">Token 使用</span>
                <span class="text-right">请求次数</span>
            </div>
            <ul class="plugin-list">
                {displayPlugins.map((plugin, idx) => {
                    const isOther = plugin.source === OTHER_PLUGIN_NAME
                    const color = isOther
                        ? OTHER_COLOR
                        : MODEL_COLORS[idx % MODEL_COLORS.length]
                    const ratio = (plugin.tokens / total) * 100
                    return (
                        <li class="plugin-list-row">
                            <div class="plugin-name-cell">
                                <span
                                    class="plugin-indicator"
                                    style={`--accent:${color}`}
                                >
                                    {' '}
                                </span>
                                {plugin.source}
                            </div>
                            <div class="plugin-progress-wrapper">
                                <div class="plugin-progress-bar">
                                    <div
                                        class="plugin-progress-fill"
                                        style={`--accent:${color}; width:${Math.max(1, Math.min(100, ratio))}%`}
                                    >
                                        {' '}
                                    </div>
                                </div>
                                <span
                                    class="plugin-number"
                                    style="min-width: 48px;"
                                >
                                    {ratio.toFixed(1)}%
                                </span>
                            </div>
                            <span class="plugin-number text-right">
                                {formatNum(plugin.tokens)}
                            </span>
                            <span class="plugin-number text-right">
                                {formatNum(plugin.calls)}
                            </span>
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}

function renderLegend(
    info: ModelInfo,
    mode: ChatLunaUsage.TokenRenderMode = 'both'
) {
    const showLine = mode === 'both' || mode === 'line'
    const showBar = mode === 'both' || mode === 'bar'

    return (
        <div class="chart-legend">
            {mode === 'line' ? (
                <div class="legend-item">
                    <span
                        class="legend-color-indicator legend-total-indicator"
                        style="--legend-color:var(--color-total)"
                    >
                        {' '}
                    </span>
                    总 Token
                </div>
            ) : null}
            {mode === 'line' ? (
                <div class="legend-item">
                    <span
                        class="legend-color-indicator legend-total-indicator"
                        style="--legend-color:var(--color-input)"
                    >
                        {' '}
                    </span>
                    输入 Token
                </div>
            ) : null}
            {mode === 'line' ? (
                <div class="legend-item">
                    <span
                        class="legend-color-indicator legend-total-indicator"
                        style="--legend-color:var(--color-output)"
                    >
                        {' '}
                    </span>
                    输出 Token
                </div>
            ) : null}
            {mode === 'both' && showLine ? (
                <div class="legend-item">
                    <span
                        class="legend-color-indicator legend-total-indicator"
                        style="--legend-color:var(--color-total)"
                    >
                        {' '}
                    </span>
                    总 Token
                </div>
            ) : null}
            {showBar
                ? Object.entries(info.colorMap).map(([model, color]) => (
                      <div class="legend-item">
                          <span
                              class="legend-color-indicator"
                              style={`--legend-color:${color}`}
                          >
                              {' '}
                          </span>
                          {model}
                      </div>
                  ))
                : null}
        </div>
    )
}

function pageHtml(
    data: ChatLunaUsage.TokenReport,
    theme: RenderTheme,
    mode: ChatLunaUsage.TokenRenderMode = 'both'
) {
    const info: ModelInfo =
        mode === 'line'
            ? { topModels: [], colorMap: {} }
            : getTopModels(data.points)

    return (
        '<!doctype html>' +
        String(
            <html lang="zh-CN">
                <head>
                    <meta charset="UTF-8" />
                    <meta
                        name="viewport"
                        content="width=device-width, initial-scale=1.0"
                    />
                    <title>ChatLuna Token 用量</title>
                    <style>{CSS}</style>
                </head>
                <body>
                    <div class={`stage theme-${theme}`}>
                        <main class="paper-content">
                            <header class="hero-header">
                                <h1 class="hero-title">ChatLuna Token 用量</h1>
                                <div class="time-strip">
                                    <span class="time-label">统计周期</span>
                                    <strong class="time-value">
                                        {formatDate(data.start)}
                                    </strong>
                                    <i class="time-sep">至</i>
                                    <strong class="time-value">
                                        {formatDate(data.end)}
                                    </strong>
                                </div>
                            </header>

                            <section class="stats-row">
                                <div class="stat-cell">
                                    <div class="stat-label">使用 Token</div>
                                    <div class="stat-value">
                                        {formatNum(data.totalTokens)}
                                    </div>
                                </div>
                                <div class="stat-cell">
                                    <div class="stat-label">请求次数</div>
                                    <div class="stat-value">
                                        {formatNum(data.calls)}
                                    </div>
                                </div>
                                <div class="stat-cell">
                                    <div class="stat-label">TPM 峰值</div>
                                    <div class="stat-value">
                                        {formatNum(data.tpm)}
                                    </div>
                                </div>
                                <div class="stat-cell">
                                    <div class="stat-label">RPM 峰值</div>
                                    <div class="stat-value">
                                        {formatNum(data.rpm)}
                                    </div>
                                </div>
                            </section>

                            <section class="chart-container">
                                {chart(data.points, info, mode)}
                                {renderLegend(info, mode)}
                            </section>
                            {pluginSection(data.plugins)}
                            <footer class="footer">
                                Generated by <span>ChatLuna</span> &amp;{' '}
                                <span>Koishi</span>
                            </footer>
                        </main>
                    </div>
                </body>
            </html>
        )
    )
}

export async function renderTokenTrend(
    ctx: Context,
    puppeteer: Context['puppeteer'],
    data: ChatLunaUsage.TokenReport,
    theme: RenderTheme = 'light',
    mode: ChatLunaUsage.TokenRenderMode = 'both'
) {
    let page: Awaited<ReturnType<Context['puppeteer']['page']>> | undefined
    try {
        page = await puppeteer.page()
        await page.setViewport({
            width: 1080,
            height: 900,
            deviceScaleFactor: 2
        })
        await page.setContent(pageHtml(data, theme, mode), {
            waitUntil: 'domcontentloaded'
        })
        await page.evaluate(() => document.fonts.ready)
        const el = await page.$('.stage')
        if (!el) {
            return '图表渲染失败：未找到图表容器。'
        }

        return await el.screenshot()
    } catch (err) {
        ctx.logger.error(err)
        return '图表渲染失败，请检查日志。'
    } finally {
        await page?.close()
    }
}
