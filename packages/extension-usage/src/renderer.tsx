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
    --bg-stage: #f8fafc;
    --bg-card: #ffffff;
    --text-primary: #0f172a;
    --text-secondary: #334155;
    --text-muted: #4b5563;
    --border-color: #cbd5e1;
    --grid-line: #cbd5e1;
    --color-total: #4f46e5;
    --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color-scheme: light;
}

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: var(--bg-stage);
}

.stage {
    display: inline-flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    background: var(--bg-stage);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Noto Sans SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
}

.stage.theme-dark {
    --bg-stage: #0f172a;
    --bg-card: #1e293b;
    --text-primary: #f8fafc;
    --text-secondary: #cbd5e1;
    --text-muted: #94a3b8;
    --border-color: #475569;
    --grid-line: #475569;
    --color-total: #818cf8;
    --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.3);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.4);
    color-scheme: dark;
}

.card {
    position: relative;
    width: 1000px;
    padding: 24px;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: var(--shadow-sm);
    color: var(--text-primary);
}

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 16px;
    margin-bottom: 20px;
}

.card-title-group h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.025em;
    color: var(--text-primary);
}

.card-subtitle {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 13px;
}

.metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 20px;
}

.metric-item {
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 16px;
    background: var(--bg-card);
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
    font-size: 24px;
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
}

.chart-container {
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 20px;
    background: var(--bg-card);
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

.dot-total {
    fill: var(--bg-card);
    stroke-width: 2;
    stroke: var(--color-total);
}

.dot-last.dot-total {
    fill: var(--color-total);
    stroke: var(--bg-card);
}

.chart-legend {
    display: flex;
    justify-content: center;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border-color);
}

.legend-item {
    display: inline-flex;
    align-items: center;
    margin: 0 16px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
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

.empty-chart {
    display: grid;
    height: 320px;
    place-items: center;
    color: var(--text-muted);
    font-size: 14px;
    border: 1px dashed var(--border-color);
    border-radius: 6px;
}

.plugin-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
}

.plugin-table th,
.plugin-table td {
    padding: 12px 16px;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
    font-size: 13px;
}

.plugin-table th {
    font-weight: 600;
    color: var(--text-secondary);
    background-color: var(--bg-stage);
}

.plugin-table td {
    color: var(--text-primary);
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
    background: var(--grid-line);
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
    '#4f46e5',
    '#0891b2',
    '#ea580c',
    '#16a34a',
    '#9333ea',
    '#db2777',
    '#059669',
    '#2563eb',
    '#d97706'
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
                                    x={x - barWidth / 2}
                                    y={groupY}
                                    width={barWidth}
                                    height={groupHeight}
                                    fill="none"
                                    stroke="var(--border-color)"
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
        <section class="card">
            <div
                class="card-header"
                style="border-bottom: 0; padding-bottom: 8px; margin-bottom: 12px;"
            >
                <div class="card-title-group">
                    <h1>各插件用量明细</h1>
                    <p class="card-subtitle">按 Token 占比降序排列</p>
                </div>
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
        <div class="chart-legend" style="flex-wrap: wrap; gap: 8px 0;">
            {showLine && (
                <div class="legend-item">
                    <span
                        class="legend-color-indicator"
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
                        <main class="card">
                            <header class="card-header">
                                <div class="card-title-group">
                                    <h1>Chatluna Token 消耗分析</h1>
                                    <p class="card-subtitle">
                                        时间跨度：{formatDate(data.start)} 至{' '}
                                        {formatDate(data.end)}
                                    </p>
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
                        </main>
                        {pluginCard(data.plugins)}
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
            width: 1040,
            height: 820,
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
