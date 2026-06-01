import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Context, Time } from 'koishi'
import type {} from 'koishi-plugin-puppeteer'
import type { ChatLunaUsage } from './index'

function renderTemplate(template: string, data: Record<string, string>) {
    return template.replace(/\$\{(.*?)}/g, (_, key) => data[key] || '')
}

function escapeHtml(value: string) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

function fmt(value: number) {
    return value.toLocaleString('en-US')
}

interface Coord {
    x: number
    y: number
    point: ChatLunaUsage.TokenPoint
}

// Monotone cubic (Fritsch-Carlson) so the curve never overshoots below the
// baseline on flat-then-spike data.
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
    if (!points.length) return '<div class="empty-chart">暂无用量数据</div>'

    const width = 968
    const height = 360
    const left = 78
    const right = 26
    const top = 30
    const bottom = 56
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom
    const baseline = top + plotHeight
    const max = Math.max(
        1,
        ...points.flatMap((p) => [p.tokens, p.inputTokens, p.outputTokens])
    )
    const makeCoords = (
        key: 'tokens' | 'inputTokens' | 'outputTokens'
    ): Coord[] =>
        points.map((point, idx) => ({
            x:
                points.length === 1
                    ? left + plotWidth / 2
                    : left + (plotWidth * idx) / (points.length - 1),
            y: baseline - (point[key] / max) * plotHeight,
            point
        }))

    const totalCoords = makeCoords('tokens')
    const inputCoords = makeCoords('inputTokens')
    const outputCoords = makeCoords('outputTokens')
    const totalLine = monotonePath(totalCoords)
    const inputLine = monotonePath(inputCoords)
    const outputLine = monotonePath(outputCoords)
    const area = totalLine
        ? `${totalLine} L${totalCoords[totalCoords.length - 1].x},${baseline} L${totalCoords[0].x},${baseline} Z`
        : ''

    const grid = Array.from({ length: 5 }, (_, idx) => {
        const y = top + (plotHeight * idx) / 4
        const value = Math.round(max - (max * idx) / 4)
        return (
            `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" />` +
            `<text x="${left - 14}" y="${y + 4}">${fmt(value)}</text>`
        )
    }).join('')

    const size = points.length > 24 ? 10 : 12
    const labels = totalCoords
        .map((c) => {
            const label = c.point.label.split(' ')
            if (label.length < 2) {
                return `<text class="axis-x" style="font-size:${size}px" x="${c.x}" y="${height - 22}">${escapeHtml(c.point.label)}</text>`
            }
            return (
                `<text class="axis-x" style="font-size:${size}px" x="${c.x}" y="${height - 28}">` +
                `<tspan x="${c.x}" dy="0">${escapeHtml(label[0])}</tspan>` +
                `<tspan x="${c.x}" dy="15">${escapeHtml(label[1])}</tspan>` +
                '</text>'
            )
        })
        .join('')

    const series: [string, Coord[]][] = [
        ['input', inputCoords],
        ['output', outputCoords],
        ['total', totalCoords]
    ]
    const dots = series
        .flatMap(([name, coords]) => {
            return coords.map((c, _, arr) => {
                const isLast = c === arr[arr.length - 1]
                const cls = isLast ? `dot-${name} dot-last` : `dot-${name}`
                return `<circle class="${cls}" cx="${c.x}" cy="${c.y}" r="${isLast ? 5.5 : 4}" />`
            })
        })
        .join('')

    return `
        <svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img">
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
            <g class="grid">${grid}</g>
            <path d="${area}" fill="url(#areaGrad)" />
            <path class="line line-input" d="${inputLine}" />
            <path class="line line-output" d="${outputLine}" />
            <path class="line line-total" d="${totalLine}" />
            ${dots}
            ${labels}
        </svg>
        <div class="chart-legend">
            <span class="legend-item" style="--legend-color:#6366f1"><i></i>总 token</span>
            <span class="legend-item" style="--legend-color:#0ea5e9"><i></i>输入 token</span>
            <span class="legend-item" style="--legend-color:#f59e0b"><i></i>输出 token</span>
        </div>
    `
}

const PLUGIN_COLORS: [string, string][] = [
    ['#6366f1', '#8b5cf6'],
    ['#0ea5e9', '#22d3ee'],
    ['#f43f5e', '#fb7185'],
    ['#f59e0b', '#fbbf24'],
    ['#10b981', '#34d399'],
    ['#a855f7', '#d946ef']
]

function pluginCard(plugins?: ChatLunaUsage.PluginUsage[]) {
    if (!plugins?.length) return ''

    const total = plugins.reduce((sum, p) => sum + p.tokens, 0) || 1
    const rows = plugins
        .map((plugin, idx) => {
            const [accent, accent2] = PLUGIN_COLORS[idx % PLUGIN_COLORS.length]
            const ratio = (plugin.tokens / total) * 100
            const width = Math.max(2, Math.min(100, ratio))
            const pct = ratio.toFixed(1)
            const style = `--accent:${accent};--accent-2:${accent2}`
            return `
                <div class="plugin-row" style="${style}">
                    <div class="plugin-name"><i></i>${escapeHtml(plugin.source)}</div>
                    <div class="plugin-meta"><b>${pct}%</b> · ${fmt(plugin.tokens)} token · ${fmt(plugin.calls)} 次</div>
                    <div class="plugin-track"><div class="plugin-fill" style="width:${width}%"></div></div>
                </div>
            `
        })
        .join('')

    const icon =
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none">' +
        '<rect x="4" y="4" width="7" height="7" rx="2" stroke="white" stroke-width="2.1"/>' +
        '<rect x="13" y="4" width="7" height="7" rx="2" stroke="white" stroke-width="2.1" opacity="0.55"/>' +
        '<rect x="4" y="13" width="7" height="7" rx="2" stroke="white" stroke-width="2.1" opacity="0.55"/>' +
        '<rect x="13" y="13" width="7" height="7" rx="2" stroke="white" stroke-width="2.1"/>' +
        '</svg>'

    return `
        <section class="token-trend-card">
            <header class="head">
                <div class="mark">${icon}</div>
                <div><h1>各插件用量明细</h1><p class="range">按 token 占比排序</p></div>
            </header>
            <div class="plugin-list">${rows}</div>
        </section>
    `
}

export async function renderTokenTrend(
    ctx: Context,
    data: ChatLunaUsage.TokenReport,
    theme: 'light' | 'dark' = 'light'
) {
    const dirname =
        __dirname?.length > 0 ? __dirname : fileURLToPath(import.meta.url)
    const templatePath = path.resolve(
        dirname,
        '../resources/token-trend/template.html'
    )
    const outDir = path.resolve(ctx.baseDir, 'data/chatluna/usage')
    const file = `${Math.random().toString(36).slice(2)}.html`
    const out = path.resolve(outDir, file)

    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(
        out,
        renderTemplate(await fs.readFile(templatePath, 'utf-8'), {
            title: 'Chatluna token 消耗趋势',
            range: `时间范围：${formatDate(data.start)} 至 ${formatDate(data.end)}`,
            chart: chart(data.points),
            pluginCard: pluginCard(data.plugins),
            themeClass: theme === 'dark' ? 'theme-dark' : 'theme-light'
        })
    )

    let page: Awaited<ReturnType<Context['puppeteer']['page']>> | undefined
    try {
        page = await ctx.puppeteer.page()
        await page.goto('file://' + out, { waitUntil: 'domcontentloaded' })
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
        await page?.close().catch((err) => ctx.logger.warn(err))
        ctx.setTimeout(() => {
            fs.unlink(out).catch((err) => ctx.logger.warn(err))
        }, 3 * Time.minute)
    }
}

function formatDate(date: Date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const min = String(date.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${d} ${h}:${min}`
}
