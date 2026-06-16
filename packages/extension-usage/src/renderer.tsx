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
    --bg-paper: #fff8ea;
    --bg-paper-soft: #f9ebd2;
    --bg-paper-row: #fff1d7;
    --bg-paper-line: rgba(122, 82, 38, 0.025);
    --bg-paper-dot: rgba(255, 255, 255, 0.65);
    --bg-paper-glow: rgba(255, 255, 255, 0.72);
    --bg-legend: rgba(255, 242, 216, 0.78);
    --bg-row: rgba(255, 244, 221, 0.78);
    --bg-row-track: rgba(165, 128, 82, 0.22);
    --text-primary: #3d3024;
    --text-secondary: #6f5b45;
    --text-muted: #9a7d5e;
    --border-color: #e7cfaa;
    --grid-line: #dcc49f;
    --color-total: #c94f72;
    --total-shadow: rgba(201, 79, 114, 0.24);
    --edge-shade: rgba(157, 110, 58, 0.07);
    --row-border: rgba(218, 183, 132, 0.42);
    --legend-border: rgba(212, 178, 128, 0.62);
    --bar-shadow: rgba(88, 56, 27, 0.16);
    --shadow-paper: 0 22px 46px -28px rgba(107, 72, 36, 0.62), 0 8px 20px -14px rgba(77, 48, 20, 0.42);
    --shadow-lift: 0 18px 28px -20px rgba(93, 58, 25, 0.48);
    --shadow-hover: 0 20px 28px -20px rgba(93, 58, 25, 0.58);
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
    background:
        radial-gradient(circle at 18% 20%, var(--bg-paper-dot) 0 1px, transparent 1px 9px),
        linear-gradient(145deg, var(--bg-paper-glow), transparent 36%),
        var(--bg-paper);
    border: 1px solid var(--border-color);
    border-radius: 30px 22px 34px 26px;
    box-shadow: var(--shadow-paper);
    color: var(--text-primary);
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Noto Sans SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
}

.stage.theme-dark {
    --bg-paper: #1b2436;
    --bg-paper-soft: #27334b;
    --bg-paper-row: #222e44;
    --bg-paper-line: rgba(255, 235, 205, 0.035);
    --bg-paper-dot: rgba(255, 241, 209, 0.08);
    --bg-paper-glow: rgba(255, 235, 197, 0.1);
    --bg-legend: rgba(41, 52, 75, 0.88);
    --bg-row: rgba(36, 47, 68, 0.86);
    --bg-row-track: rgba(223, 189, 137, 0.16);
    --text-primary: #fff0d8;
    --text-secondary: #dec69f;
    --text-muted: #b5966a;
    --border-color: #725d3e;
    --grid-line: #695944;
    --color-total: #f2c66d;
    --total-shadow: rgba(242, 198, 109, 0.3);
    --edge-shade: rgba(255, 211, 144, 0.08);
    --row-border: rgba(153, 123, 82, 0.44);
    --legend-border: rgba(153, 123, 82, 0.55);
    --bar-shadow: rgba(0, 0, 0, 0.24);
    --shadow-paper: 0 28px 52px -28px rgba(0, 0, 0, 0.62), 0 8px 20px -12px rgba(0, 0, 0, 0.42);
    --shadow-lift: 0 20px 30px -18px rgba(0, 0, 0, 0.42);
    --shadow-hover: 0 22px 30px -18px rgba(0, 0, 0, 0.52);
    color-scheme: dark;
}

.stage::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
        linear-gradient(90deg, var(--edge-shade), transparent 12%, transparent 86%, var(--edge-shade)),
        repeating-linear-gradient(0deg, var(--bg-paper-line) 0 1px, transparent 1px 7px);
    mix-blend-mode: multiply;
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
    border: 1px solid var(--border-color);
    border-radius: 999px 22px 999px 22px;
    box-shadow: var(--shadow-lift);
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

.metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 24px;
}

.metric-item {
    position: relative;
    border: 1px solid var(--border-color);
    border-radius: 18px 14px 20px 13px;
    padding: 15px 16px 16px;
    background: var(--bg-paper-row);
    box-shadow: var(--shadow-lift);
    transition:
        transform 180ms ease,
        box-shadow 180ms ease;
}

.metric-item:nth-child(2n) {
    transform: rotate(0.25deg);
}

.metric-item:nth-child(2n + 1) {
    transform: rotate(-0.2deg);
}

.metric-item:hover {
    transform: translateY(-3px) rotate(0deg);
    box-shadow: var(--shadow-hover);
}

.metric-item:active {
    transform: translateY(1px) rotate(0deg);
    box-shadow: 0 12px 20px -18px rgba(93, 58, 25, 0.46);
}

.metric-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.metric-value {
    margin-top: 8px;
    font-size: 25px;
    font-weight: 800;
    font-family: var(--font-mono);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
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
    filter: drop-shadow(0 3px 3px var(--total-shadow));
}

.dot-total {
    fill: var(--bg-paper);
    stroke-width: 2;
    stroke: var(--color-total);
}

.dot-last.dot-total {
    fill: var(--color-total);
    stroke: var(--bg-paper);
}

.bar-piece {
    filter: drop-shadow(0 4px 4px var(--bar-shadow));
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
    padding: 6px 10px;
    background: var(--bg-legend);
    border: 1px solid var(--legend-border);
    border-radius: 999px;
    box-shadow: 0 10px 16px -14px rgba(93, 58, 25, 0.38);
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    transition:
        transform 160ms ease,
        box-shadow 160ms ease;
}

.legend-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 14px 20px -16px rgba(93, 58, 25, 0.5);
}

.legend-item:active {
    transform: translateY(1px);
}

.legend-color-indicator {
    display: inline-block;
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border-radius: 2px;
    background: var(--legend-color);
    border: 1px solid rgba(0, 0, 0, 0.05);
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
    border: 1px dashed var(--border-color);
    border-radius: 6px;
}

.plugin-section {
    margin-top: 24px;
    padding-top: 22px;
    border-top: 2px dashed rgba(180, 135, 82, 0.38);
}

.section-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
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
    border: 1px solid var(--border-color);
    border-radius: 999px 18px 999px 18px;
    box-shadow: 0 10px 18px -16px rgba(93, 58, 25, 0.45);
    font-size: 12px;
    font-weight: 700;
}

.plugin-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 8px;
    margin-top: 0;
}

.plugin-table th,
.plugin-table td {
    padding: 11px 16px;
    text-align: left;
    font-size: 13px;
}

.plugin-table th {
    font-weight: 600;
    color: var(--text-secondary);
    border-bottom: 1px solid rgba(180, 135, 82, 0.35);
}

.plugin-table td {
    background: var(--bg-row);
    border-top: 1px solid var(--row-border);
    border-bottom: 1px solid var(--row-border);
    color: var(--text-primary);
}

.plugin-table td:first-child {
    border-left: 1px solid var(--row-border);
    border-radius: 16px 0 0 14px;
}

.plugin-table td:last-child {
    border-right: 1px solid var(--row-border);
    border-radius: 0 14px 16px 0;
}

.plugin-table tbody tr {
    transition:
        transform 180ms ease,
        filter 180ms ease;
}

.plugin-table tbody tr:hover {
    transform: translateY(-2px);
    filter: drop-shadow(0 10px 10px rgba(93, 58, 25, 0.14));
}

.plugin-table tbody tr:active {
    transform: translateY(1px);
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
    margin-right: 8px;
    font-size: 0;
    line-height: 0;
}

.plugin-progress-wrapper {
    display: inline-flex;
    align-items: center;
}

.plugin-progress-bar {
    width: 100px;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-row-track);
    overflow: hidden;
    margin-right: 12px;
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
`

const MODEL_COLORS = [
    '#7d82f3',
    '#1aa6b7',
    '#f47b3f',
    '#3ab86a',
    '#a967e8',
    '#df6f9f',
    '#34a889',
    '#4d91df',
    '#d99a38'
]

function formatNum(value: number) {
    if (value >= 1000000) {
        return (value / 1000000).toFixed(2) + 'M'
    }
    return value.toLocaleString('en-US')
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
        const factor = 0.4

        const c1x = pts[i].x + dx * factor
        let c1y = pts[i].y + t[i] * dx * factor
        const c2x = pts[i + 1].x - dx * factor
        let c2y = pts[i + 1].y - t[i + 1] * dx * factor

        if (Math.abs(pts[i].y - pts[i + 1].y) < 0.1) {
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

    const topModels = sortedModels.slice(0, 5)

    const colorMap: Record<string, string> = {}
    topModels.forEach((model, i) => {
        colorMap[model] = MODEL_COLORS[i % MODEL_COLORS.length]
    })
    if (sortedModels.length > 5) {
        colorMap['其他模型'] = '#94a3b8'
    }
    return { topModels, colorMap }
}

function chart(
    points: ChatLunaUsage.TokenPoint[],
    mode: ChatLunaUsage.TokenRenderMode = 'both'
) {
    if (!points.length) return <div class="empty-chart">暂无用量数据</div>

    const [width, height, left, right, top, bottom] = [952, 320, 60, 20, 20, 48]
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom
    const baseline = top + plotHeight
    const max = Math.max(1, ...points.flatMap((p) => [p.tokens]))

    const { topModels, colorMap } = getTopModels(points)
    const stepX =
        points.length > 1 ? plotWidth / (points.length - 1) : plotWidth
    const barWidth = Math.max(3, Math.min(28, stepX * 0.5))

    const safePadding = barWidth / 2 + 4
    const drawWidth = plotWidth - safePadding * 2

    const totalCoords = points.map((point, idx) => ({
        x:
            points.length === 1
                ? left + plotWidth / 2
                : left + safePadding + (drawWidth * idx) / (points.length - 1),
        y: baseline - (point.tokens / max) * plotHeight,
        point
    }))

    const totalLine = monotonePath(totalCoords)

    const maxLabels = 12
    const stepLabel = Math.max(1, Math.ceil(points.length / maxLabels))

    return (
        <svg class="trend-chart" viewbox={`0 0 ${width} ${height}`} role="img">
            <g class="grid">
                {Array.from({ length: 5 }, (_, idx) => {
                    const y = top + (plotHeight * idx) / 4
                    const value = Math.round(max - (max * idx) / 4)
                    return [
                        <line x1={left} y1={y} x2={width - right} y2={y} />,
                        <text x={left - 12} y={y + 4}>
                            {formatNum(value)}
                        </text>
                    ]
                })}
            </g>

            {(mode === 'both' || mode === 'bar') &&
                points.map((point, idx) => {
                    const x =
                        points.length === 1
                            ? left + plotWidth / 2
                            : left +
                              safePadding +
                              (drawWidth * idx) / (points.length - 1)

                    const activeModels: { name: string; val: number }[] = []
                    let otherVal = 0

                    for (const [mName, val] of Object.entries(point.models)) {
                        if (val <= 0) continue
                        if (topModels.includes(mName)) {
                            activeModels.push({ name: mName, val })
                        } else {
                            otherVal += val
                        }
                    }

                    activeModels.sort(
                        (a, b) =>
                            topModels.indexOf(a.name) -
                            topModels.indexOf(b.name)
                    )

                    if (otherVal > 0) {
                        activeModels.push({ name: '其他模型', val: otherVal })
                    }

                    let currentY = baseline
                    const groupHeight = activeModels.reduce(
                        (sum, item) => sum + (item.val / max) * plotHeight,
                        0
                    )
                    const groupY = baseline - groupHeight

                    return (
                        <g>
                            {activeModels.map((item) => {
                                const barHeight = (item.val / max) * plotHeight
                                const y = currentY - barHeight
                                currentY = y
                                return (
                                    <rect
                                        class="bar-piece"
                                        x={x - barWidth / 2}
                                        y={y}
                                        width={barWidth}
                                        height={barHeight}
                                        fill={colorMap[item.name]}
                                        opacity="0.85"
                                    />
                                )
                            })}
                            {groupHeight > 0 && (
                                <rect
                                    class="bar-outline"
                                    x={x - barWidth / 2}
                                    y={groupY}
                                    width={barWidth}
                                    height={groupHeight}
                                    fill="none"
                                    stroke-width="1"
                                    opacity="0.6"
                                />
                            )}
                        </g>
                    )
                })}

            {(mode === 'both' || mode === 'line') && totalLine && (
                <path class="line line-total" d={totalLine} />
            )}

            {mode === 'line' &&
                totalCoords.map((c, idx) => {
                    const last = idx === totalCoords.length - 1
                    return (
                        <circle
                            class={last ? 'dot-total dot-last' : 'dot-total'}
                            cx={c.x}
                            cy={c.y}
                            r={last ? 5.5 : 4}
                        />
                    )
                })}

            {totalCoords.map((c, idx) => {
                const shouldShowLabel =
                    idx === 0 ||
                    idx === totalCoords.length - 1 ||
                    idx % stepLabel === 0
                if (!shouldShowLabel) return null

                const parts = c.point.label.split(' ')
                return (
                    <text
                        class="axis-x"
                        x={c.x}
                        y={height - (parts[1] ? 22 : 18)}
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
            })}
        </svg>
    )
}

function pluginCard(plugins?: ChatLunaUsage.TokenReport['plugins']) {
    if (!plugins?.length) return ''

    const total = plugins.reduce((sum, p) => sum + p.tokens, 0) || 1

    const maxDisplay = 6
    let displayPlugins = plugins.slice(0, maxDisplay)
    if (plugins.length > maxDisplay) {
        const otherTokens = plugins
            .slice(maxDisplay)
            .reduce((sum, p) => sum + p.tokens, 0)
        const otherCalls = plugins
            .slice(maxDisplay)
            .reduce((sum, p) => sum + p.calls, 0)
        displayPlugins = [
            ...displayPlugins,
            {
                source: '其他插件',
                tokens: otherTokens,
                calls: otherCalls
            }
        ]
    }

    return (
        <section class="plugin-section">
            <div class="section-title-row">
                <h2>各插件用量明细</h2>
                <span class="sort-chip">按 Token 占比降序排列</span>
            </div>
            <table class="plugin-table">
                <thead>
                    <tr>
                        <th style="text-align: left;">来源插件</th>
                        <th class="text-center" style="width: 220px;">
                            用量占比
                        </th>
                        <th class="text-center" style="width: 180px;">
                            总 Token 消耗
                        </th>
                        <th class="text-center" style="width: 140px;">
                            调用次数
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {displayPlugins.map((plugin, idx) => {
                        const isOther = plugin.source === '其他插件'
                        const color = isOther
                            ? '#94a3b8'
                            : MODEL_COLORS[idx % MODEL_COLORS.length]
                        const ratio = (plugin.tokens / total) * 100
                        return (
                            <tr>
                                <td>
                                    <div class="plugin-name-cell">
                                        <span
                                            class="plugin-indicator"
                                            style={`--accent:${color}`}
                                        >
                                            {' '}
                                        </span>
                                        {plugin.source}
                                    </div>
                                </td>
                                <td class="text-center">
                                    <div
                                        class="plugin-progress-wrapper"
                                        style="justify-content: center;"
                                    >
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
                                            style="min-width: 45px;"
                                        >
                                            {ratio.toFixed(1)}%
                                        </span>
                                    </div>
                                </td>
                                <td class="plugin-number text-center">
                                    {formatNum(plugin.tokens)}
                                </td>
                                <td class="plugin-number text-center">
                                    {formatNum(plugin.calls)}
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </section>
    )
}

function renderLegend(
    points: ChatLunaUsage.TokenPoint[],
    mode: ChatLunaUsage.TokenRenderMode = 'both'
) {
    const { colorMap } = getTopModels(points)
    const showLine = mode === 'both' || mode === 'line'
    const showBar = mode === 'both' || mode === 'bar'

    return (
        <div class="chart-legend">
            {showLine && (
                <div class="legend-item">
                    <span
                        class="legend-color-indicator legend-total-indicator"
                        style="--legend-color:var(--color-total)"
                    >
                        {' '}
                    </span>
                    总 Token
                </div>
            )}
            {showBar &&
                Object.entries(colorMap).map(([model, color]) => (
                    <div class="legend-item">
                        <span
                            class="legend-color-indicator"
                            style={`--legend-color:${color}`}
                        >
                            {' '}
                        </span>
                        {model}
                    </div>
                ))}
        </div>
    )
}

function pageHtml(
    data: ChatLunaUsage.TokenReport,
    theme: RenderTheme,
    mode: ChatLunaUsage.TokenRenderMode = 'both'
) {
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
                    <title>Chatluna Token 消耗分析</title>
                    <style>{CSS}</style>
                </head>
                <body>
                    <div class={`stage theme-${theme}`}>
                        <main class="paper-content">
                            <header class="hero-header">
                                <h1 class="hero-title">
                                    Chatluna Token 消耗分析
                                </h1>
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

                            <section class="metrics-grid">
                                <div class="metric-item">
                                    <div class="metric-label">
                                        累计消耗 Token
                                    </div>
                                    <div class="metric-value">
                                        {formatNum(data.totalTokens)}
                                    </div>
                                </div>
                                <div class="metric-item">
                                    <div class="metric-label">累计请求次数</div>
                                    <div class="metric-value">
                                        {formatNum(data.calls)}
                                    </div>
                                </div>
                                <div class="metric-item">
                                    <div class="metric-label">
                                        TPM 峰值 (每分钟)
                                    </div>
                                    <div class="metric-value">
                                        {formatNum(data.tpm)}
                                    </div>
                                </div>
                                <div class="metric-item">
                                    <div class="metric-label">
                                        RPM 峰值 (每分钟)
                                    </div>
                                    <div class="metric-value">
                                        {formatNum(data.rpm)}
                                    </div>
                                </div>
                            </section>

                            <section class="chart-container">
                                {chart(data.points, mode)}
                                {renderLegend(data.points, mode)}
                            </section>
                            {pluginCard(data.plugins)}
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
