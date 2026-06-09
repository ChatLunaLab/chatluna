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
    color-scheme: light;
}
* {
    box-sizing: border-box;
}
body {
    margin: 0;
}
.stage {
    --card: #ffffff;
    --text: #0f172a;
    --muted: #64748b;
    --faint: #94a3b8;
    --brand: #6366f1;
    --brand-2: #8b5cf6;
    --border: #eef0f6;
    color-scheme: light;
    display: inline-flex;
    flex-direction: column;
    gap: 24px;
    padding: 56px;
    background:
        radial-gradient(1100px 560px at 10% -10%, #e7e9ff 0%, transparent 55%),
        radial-gradient(900px 480px at 110% 0%, #f5e9ff 0%, transparent 50%),
        linear-gradient(180deg, #eef1ff, #f7f8fc);
    font-family: Inter, "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
}
.stage.theme-dark {
    --card: #111827;
    --text: #e5e7eb;
    --muted: #94a3b8;
    --faint: #64748b;
    --border: #253044;
    color-scheme: dark;
    background:
        radial-gradient(1100px 560px at 10% -10%, rgba(79, 70, 229, 0.28) 0%, transparent 55%),
        radial-gradient(900px 480px at 110% 0%, rgba(14, 165, 233, 0.18) 0%, transparent 50%),
        linear-gradient(180deg, #0b1020, #111827);
}
.token-trend-card {
    position: relative;
    width: 1040px;
    padding: 38px 40px 28px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 24px;
    box-shadow:
        0 24px 60px -20px rgba(49, 46, 129, 0.30),
        0 8px 24px -12px rgba(15, 23, 42, 0.12);
    overflow: hidden;
    color: var(--text);
}
.token-trend-card::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 5px;
    background: linear-gradient(90deg, var(--brand), var(--brand-2));
}
.stage.theme-dark .token-trend-card {
    box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.65), 0 8px 24px -12px rgba(0, 0, 0, 0.55);
}
.head {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 26px;
}
.mark {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: linear-gradient(140deg, var(--brand), var(--brand-2));
    box-shadow: 0 10px 22px -8px rgba(99, 102, 241, 0.65);
}
h1 {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1.25;
}
.range {
    margin: 5px 0 0;
    color: var(--muted);
    font-size: 14px;
}
.chart-wrap {
    padding: 18px 16px 12px;
    border: 1px solid var(--border);
    border-radius: 18px;
    background: radial-gradient(620px 220px at 82% -10%, rgba(139, 92, 246, 0.07), transparent 60%), linear-gradient(180deg, #ffffff, #fbfcff);
}
.stage.theme-dark .chart-wrap {
    background: radial-gradient(620px 220px at 82% -10%, rgba(14, 165, 233, 0.10), transparent 60%), linear-gradient(180deg, #111827, #0f172a);
}
.trend-chart {
    display: block;
    width: 100%;
    height: auto;
}
.grid line {
    stroke: #eef1f6;
    stroke-width: 1;
}
.stage.theme-dark .grid line {
    stroke: #253044;
}
.grid text {
    fill: var(--faint);
    font-size: 12px;
    text-anchor: end;
    font-variant-numeric: tabular-nums;
}
.axis-x {
    fill: var(--faint);
    font-size: 12px;
    text-anchor: middle;
}
.line {
    fill: none;
    stroke-width: 3.5;
    stroke-linecap: round;
    stroke-linejoin: round;
}
.line-total {
    stroke: url(#totalGrad);
}
.line-input {
    stroke: #0ea5e9;
}
.line-output {
    stroke: #f59e0b;
}
.dot-total,
.dot-input,
.dot-output {
    fill: var(--card);
    stroke-width: 3;
}
.dot-total {
    stroke: #6366f1;
}
.dot-input {
    stroke: #0ea5e9;
}
.dot-output {
    stroke: #f59e0b;
}
.dot-last.dot-total {
    fill: #6366f1;
    stroke: #fff;
}
.dot-last.dot-input {
    fill: #0ea5e9;
    stroke: #fff;
}
.dot-last.dot-output {
    fill: #f59e0b;
    stroke: #fff;
}
.chart-legend {
    display: flex;
    justify-content: center;
    gap: 22px;
    margin: 12px 0 0;
    color: var(--muted);
    font-size: 13px;
}
.legend-item {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-variant-numeric: tabular-nums;
}
.legend-item i {
    width: 26px;
    height: 3px;
    border-radius: 999px;
    background: var(--legend-color);
    box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.03);
}
.empty-chart {
    display: grid;
    height: 360px;
    place-items: center;
    color: var(--faint);
    font-size: 16px;
}
.plugin-list {
    display: flex;
    flex-direction: column;
    gap: 18px;
}
.plugin-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 12px;
    align-items: baseline;
}
.plugin-name {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
}
.plugin-name i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
}
.plugin-meta {
    font-size: 13px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
}
.plugin-meta b {
    color: var(--text);
    font-weight: 700;
    font-size: 15px;
}
.plugin-track {
    grid-column: 1 / -1;
    height: 10px;
    border-radius: 6px;
    background: #f1f3f9;
    overflow: hidden;
}
.stage.theme-dark .plugin-track {
    background: #1f2937;
}
.plugin-fill {
    height: 100%;
    border-radius: 6px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
}
`

const PLUGIN_COLORS: [string, string][] = [
    ['#6366f1', '#8b5cf6'],
    ['#0ea5e9', '#22d3ee'],
    ['#f43f5e', '#fb7185'],
    ['#f59e0b', '#fbbf24'],
    ['#10b981', '#34d399'],
    ['#a855f7', '#d946ef']
]

function fmt(value: number) {
    return value.toLocaleString('en-US')
}

function monotonePath(pts: Coord[]) {
    const n = pts.length
    if (n < 2) return ''
    if (n === 2) {
        return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`
    }

    const dx: number[] = []
    const slope: number[] = []
    for (let i = 0; i < n - 1; i++) {
        dx[i] = pts[i + 1].x - pts[i].x
        slope[i] = (pts[i + 1].y - pts[i].y) / dx[i]
    }

    const t: number[] = [slope[0]]
    for (let i = 1; i < n - 1; i++) {
        t[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
    }
    t[n - 1] = slope[n - 2]

    for (let i = 0; i < n - 1; i++) {
        if (slope[i] === 0) {
            t[i] = 0
            t[i + 1] = 0
            continue
        }
        const a = t[i] / slope[i]
        const b = t[i + 1] / slope[i]
        const h = Math.hypot(a, b)
        if (h > 3) {
            const k = 3 / h
            t[i] = k * a * slope[i]
            t[i + 1] = k * b * slope[i]
        }
    }

    let d = `M${pts[0].x},${pts[0].y}`
    for (let i = 0; i < n - 1; i++) {
        const c1x = pts[i].x + dx[i] / 3
        const c1y = pts[i].y + (t[i] * dx[i]) / 3
        const c2x = pts[i + 1].x - dx[i] / 3
        const c2y = pts[i + 1].y - (t[i + 1] * dx[i]) / 3
        d += ` C${c1x},${c1y} ${c2x},${c2y} ${pts[i + 1].x},${pts[i + 1].y}`
    }
    return d
}

function chart(points: ChatLunaUsage.TokenPoint[]) {
    if (!points.length) return <div class="empty-chart">暂无用量数据</div>

    const [width, height, left, right, top, bottom] = [968, 360, 78, 26, 30, 56]
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom
    const baseline = top + plotHeight
    const max = Math.max(
        1,
        ...points.flatMap((p) => [p.tokens, p.inputTokens, p.outputTokens])
    )
    const [totalCoords, inputCoords, outputCoords] = (
        ['tokens', 'inputTokens', 'outputTokens'] as const
    ).map((key) =>
        points.map((point, idx) => ({
            x:
                points.length === 1
                    ? left + plotWidth / 2
                    : left + (plotWidth * idx) / (points.length - 1),
            y: baseline - (point[key] / max) * plotHeight,
            point
        }))
    )
    const [totalLine, inputLine, outputLine] = [
        totalCoords,
        inputCoords,
        outputCoords
    ].map(monotonePath)
    const area = totalLine
        ? `${totalLine} L${totalCoords[totalCoords.length - 1].x},${baseline} L${totalCoords[0].x},${baseline} Z`
        : ''
    const size = points.length > 24 ? 10 : 12

    return [
        <svg class="trend-chart" viewbox={`0 0 ${width} ${height}`} role="img">
            <defs>
                <linearGradient id="totalGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="#6366f1" />
                    <stop offset="100%" stop-color="#8b5cf6" />
                </linearGradient>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="rgba(99,102,241,0.30)" />
                    <stop offset="100%" stop-color="rgba(139,92,246,0.02)" />
                </linearGradient>
            </defs>
            <g class="grid">
                {Array.from({ length: 5 }, (_, idx) => {
                    const y = top + (plotHeight * idx) / 4
                    const value = Math.round(max - (max * idx) / 4)
                    return [
                        <line x1={left} y1={y} x2={width - right} y2={y} />,
                        <text x={left - 14} y={y + 4}>
                            {fmt(value)}
                        </text>
                    ]
                })}
            </g>
            <path d={area} fill="url(#areaGrad)" />
            <path class="line line-input" d={inputLine} />
            <path class="line line-output" d={outputLine} />
            <path class="line line-total" d={totalLine} />
            {[
                ['input', inputCoords] as const,
                ['output', outputCoords] as const,
                ['total', totalCoords] as const
            ].flatMap(([name, coords]) =>
                coords.map((c, idx) => {
                    const last = idx === coords.length - 1
                    return (
                        <circle
                            class={
                                last ? `dot-${name} dot-last` : `dot-${name}`
                            }
                            cx={c.x}
                            cy={c.y}
                            r={last ? 5.5 : 4}
                        />
                    )
                })
            )}
            {totalCoords.map((c) => {
                const parts = c.point.label.split(' ')
                return (
                    <text
                        class="axis-x"
                        style={`font-size:${size}px`}
                        x={c.x}
                        y={height - (parts[1] ? 28 : 22)}
                    >
                        {parts[1]
                            ? parts.map((part, idx) => (
                                  <tspan x={c.x} dy={idx ? '15' : '0'}>
                                      {part}
                                  </tspan>
                              ))
                            : c.point.label}
                    </text>
                )
            })}
        </svg>,
        <div class="chart-legend">
            <span class="legend-item" style="--legend-color:#6366f1">
                <i></i>总 token
            </span>
            <span class="legend-item" style="--legend-color:#0ea5e9">
                <i></i>输入 token
            </span>
            <span class="legend-item" style="--legend-color:#f59e0b">
                <i></i>输出 token
            </span>
        </div>
    ]
}

function trendIcon() {
    return (
        <svg width="24" height="24" viewbox="0 0 24 24" fill="none">
            <path
                d="M4 16l4.5-5 3.5 3.5L20 7"
                stroke="white"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
            <path
                d="M4 20h15"
                stroke="white"
                stroke-width="2.2"
                stroke-linecap="round"
                opacity="0.55"
            />
        </svg>
    )
}

function pluginIcon() {
    return (
        <svg width="24" height="24" viewbox="0 0 24 24" fill="none">
            <rect
                x="4"
                y="4"
                width="7"
                height="7"
                rx="2"
                stroke="white"
                stroke-width="2.1"
            />
            <rect
                x="13"
                y="4"
                width="7"
                height="7"
                rx="2"
                stroke="white"
                stroke-width="2.1"
                opacity="0.55"
            />
            <rect
                x="4"
                y="13"
                width="7"
                height="7"
                rx="2"
                stroke="white"
                stroke-width="2.1"
                opacity="0.55"
            />
            <rect
                x="13"
                y="13"
                width="7"
                height="7"
                rx="2"
                stroke="white"
                stroke-width="2.1"
            />
        </svg>
    )
}

function pluginCard(plugins?: ChatLunaUsage.TokenReport['plugins']) {
    if (!plugins?.length) return ''

    const total = plugins.reduce((sum, p) => sum + p.tokens, 0) || 1

    return (
        <section class="token-trend-card">
            <header class="head">
                <div class="mark">{pluginIcon()}</div>
                <div>
                    <h1>各插件用量明细</h1>
                    <p class="range">按 token 占比排序</p>
                </div>
            </header>
            <div class="plugin-list">
                {plugins.map((plugin, idx) => {
                    const [accent, accent2] =
                        PLUGIN_COLORS[idx % PLUGIN_COLORS.length]
                    const ratio = (plugin.tokens / total) * 100
                    return (
                        <div
                            class="plugin-row"
                            style={`--accent:${accent};--accent-2:${accent2}`}
                        >
                            <div class="plugin-name">
                                <i></i>
                                {plugin.source}
                            </div>
                            <div class="plugin-meta">
                                <b>{ratio.toFixed(1)}%</b> ·{' '}
                                {fmt(plugin.tokens)} token · {fmt(plugin.calls)}{' '}
                                次
                            </div>
                            <div class="plugin-track">
                                <div
                                    class="plugin-fill"
                                    style={`width:${Math.max(2, Math.min(100, ratio))}%`}
                                ></div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </section>
    )
}

function pageHtml(data: ChatLunaUsage.TokenReport, theme: RenderTheme) {
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
                    <title>Chatluna token 消耗趋势</title>
                    <style>{CSS}</style>
                </head>
                <body>
                    <div class={`stage theme-${theme}`}>
                        <main class="token-trend-card">
                            <header class="head">
                                <div class="mark">{trendIcon()}</div>
                                <div>
                                    <h1>Chatluna token 消耗趋势</h1>
                                    <p class="range">
                                        时间范围：{formatDate(data.start)} 至{' '}
                                        {formatDate(data.end)}
                                    </p>
                                </div>
                            </header>
                            <section class="chart-wrap">
                                {chart(data.points)}
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
    theme: RenderTheme = 'light'
) {
    let page: Awaited<ReturnType<Context['puppeteer']['page']>> | undefined
    try {
        page = await puppeteer.page()
        await page.setContent(pageHtml(data, theme), {
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
