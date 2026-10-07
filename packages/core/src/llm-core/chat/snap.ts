import type { MessageContentComplex } from '@langchain/core/messages'
import type { Renderer, TextNode } from '@takumi-rs/wasm'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'

const WIDTH = 1200
const MAX_HEIGHT = 1536
const PADDING = 48
const FONT_SIZE = 22
// Noto Sans SC at 22px has ~31.86px ascent/descent, exceeding a 30px row.
const LINE_HEIGHT = 36
const ROWS_PER_PAGE = Math.floor((MAX_HEIGHT - PADDING * 2) / LINE_HEIGHT)
const MAX_IMAGES = 16
const MAX_SOURCE_BYTES = 256 * 1024
// Includes base64 expansion and space for image_url JSON, not just PNG bytes.
const MAX_REQUEST_BYTES = 8 * 1024 * 1024
const FONT_FAMILIES = ['Noto Sans', 'Noto Sans SC']
let rendererPromise: Promise<Renderer> | undefined

export function imageTokens(
    model: string,
    width: number,
    height: number
): number {
    // Only recognize actual model names, optionally qualified by a provider.
    const name = model.toLowerCase().split('/').pop()
    // https://developers.openai.com/api/docs/guides/images-vision
    const patchMultiplier = /^(?:gpt-4\.1-mini)(?:-|$)/.test(name)
        ? 1.62
        : /^(?:gpt-4\.1-nano)(?:-|$)/.test(name)
          ? 2.46
          : /^(?:o4-mini)(?:-|$)/.test(name)
            ? 1.72
            : /^(?:gpt-5-nano)(?:-|$)/.test(name)
              ? 1.5
              : /^(?:gpt-5-mini)(?:-|$)/.test(name)
                ? 1.2
                : undefined
    if (patchMultiplier != null) {
        // Unresized patches deliberately overestimate the provider's patch cap.
        return Math.ceil(
            Math.ceil(width / 32) * Math.ceil(height / 32) * patchMultiplier
        )
    }
    const mini = /^gpt-4o-mini(?:-|$)/.test(name)
    const tiled = mini || /^(?:gpt-4o|gpt-4\.1)(?:-|$)/.test(name)
    if (tiled) {
        const scale = Math.min(1, 2048 / Math.max(width, height))
        width = Math.floor(width * scale)
        height = Math.floor(height * scale)
        const detailScale = Math.min(1, 768 / Math.min(width, height))
        width = Math.floor(width * detailScale)
        height = Math.floor(height * detailScale)
        return (
            (mini ? 2833 : 85) +
            Math.ceil(width / 512) *
                Math.ceil(height / 512) *
                (mini ? 5667 : 170)
        )
    }
    // Use 32px patches when the model's image pricing rule is unknown.
    return Math.ceil(width / 32) * Math.ceil(height / 32)
}

export async function renderContext(
    text: string,
    opts: { maxTokens: number; model: string; signal?: AbortSignal }
): Promise<{ content: MessageContentComplex[]; tokens: number } | undefined> {
    opts.signal?.throwIfAborted()
    if (
        text.length === 0 ||
        !Number.isFinite(opts.maxTokens) ||
        opts.maxTokens <= 0 ||
        Buffer.byteLength(text, 'utf8') > MAX_SOURCE_BYTES
    ) {
        return undefined
    }

    rendererPromise ??= (async () => {
        // Takumi is ESM-only; Node 18 CJS builds cannot statically require it.
        const { default: init, Renderer } = await import('@takumi-rs/wasm')
        // Both branches survive Node >=18 ESM/CJS output; never resolve from cwd.
        const require = createRequire(
            typeof __filename === 'string' ? __filename : import.meta.url
        )
        await init({
            module_or_path: await readFile(
                require.resolve('@takumi-rs/wasm/takumi_wasm_bg.wasm')
            )
        })
        const renderer = new Renderer()
        try {
            // Unique subset family names prevent same-weight faces replacing one
            // another. Takumi's subsetOf expands the logical fallback families.
            const subsets = [
                'latin',
                'latin-ext',
                'cyrillic',
                'cyrillic-ext',
                'greek',
                'greek-ext',
                'devanagari',
                'vietnamese'
            ]
            const fonts = await Promise.all(
                subsets.map(async (subset, subsetRank) => ({
                    name: `Noto Sans ${subset}`,
                    subsetOf: 'Noto Sans',
                    subsetRank,
                    weight: 400,
                    data: await readFile(
                        require.resolve(
                            `@fontsource/noto-sans/files/noto-sans-${subset}-400-normal.woff2`
                        )
                    )
                }))
            )
            for (const font of fonts) await renderer.registerFont(font)
            // Noto Sans metadata has no Chinese coverage. Use the packaged
            // consolidated SC face, not a single Google Fonts numbered shard.
            await renderer.registerFont({
                name: 'Noto Sans SC',
                weight: 400,
                data: await readFile(
                    require.resolve('@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2')
                )
            })
            return renderer
        } catch (error) {
            renderer.free()
            throw error
        }
    })().catch((error) => {
        rendererPromise = undefined
        throw error
    })
    const renderer = await rendererPromise
    opts.signal?.throwIfAborted()

    const style: TextNode['style'] = {
        fontFamily: '"Noto Sans", "Noto Sans SC"',
        fontSize: FONT_SIZE,
        fontWeight: 400,
        lineHeight: `${LINE_HEIGHT}px`,
        whiteSpace: 'pre',
        color: '#000000'
    }
    const rows: string[] = []
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    // Newlines become real rows (including empty/trailing rows). Other control
    // characters are shown as escapes rather than invisibly discarded by CSS.
    const lines = text.split(/\r\n|[\r\n\u2028\u2029]/u)
    for (const line of lines) {
        opts.signal?.throwIfAborted()
        const visible = line.replace(
            // eslint-disable-next-line no-control-regex
            /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/gu,
            (char) =>
                char === '\t'
                    ? '\\t'
                    : `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
        )
        const graphemes = Array.from(
            segmenter.segment(visible),
            (item) => item.segment
        )
        if (graphemes.length === 0) rows.push('')
        for (let offset = 0; offset < graphemes.length;) {
            opts.signal?.throwIfAborted()
            let low = 1
            let high = Math.min(128, graphemes.length - offset)
            let fit = 0
            // Measure actual loaded-font widths, not UTF-16 length or guessed
            // CJK widths. Breaking only at graphemes keeps combining text intact.
            while (low <= high) {
                const count = Math.floor((low + high) / 2)
                const candidate = graphemes
                    .slice(offset, offset + count)
                    .join('')
                const measured = await renderer.measure(
                    { type: 'text', text: candidate, style },
                    { fontFamilies: FONT_FAMILIES, signal: opts.signal }
                )
                if (
                    measured.width <= WIDTH - PADDING * 2 &&
                    // SC layout boxes round up to 37px for a 36px line;
                    // check the actual glyph runs rather than that rounded box.
                    measured.runs.every(
                        (run) => run.y >= 0 && run.y + run.height <= LINE_HEIGHT
                    )
                ) {
                    fit = count
                    low = count + 1
                } else {
                    high = count - 1
                }
            }
            // Even an indivisible grapheme must fit; never crop it at an edge.
            if (fit === 0) return undefined
            rows.push(graphemes.slice(offset, offset + fit).join(''))
            offset += fit
            if (rows.length > ROWS_PER_PAGE * MAX_IMAGES) return undefined
        }
        if (rows.length > ROWS_PER_PAGE * MAX_IMAGES) return undefined
    }

    const pageCount = Math.ceil(rows.length / ROWS_PER_PAGE)
    let tokens = 0
    for (let page = 0; page < pageCount; page++) {
        const count = Math.min(
            ROWS_PER_PAGE,
            rows.length - page * ROWS_PER_PAGE
        )
        tokens += imageTokens(
            opts.model,
            WIDTH,
            PADDING * 2 + count * LINE_HEIGHT
        )
    }
    if (tokens > opts.maxTokens) return undefined

    const content: MessageContentComplex[] = []
    let requestBytes = 2
    for (let page = 0; page < pageCount; page++) {
        // Let pending cancellation run between CPU-bound WASM page renders.
        await setImmediate(undefined, { signal: opts.signal })
        opts.signal?.throwIfAborted()
        const pageRows = rows.slice(
            page * ROWS_PER_PAGE,
            (page + 1) * ROWS_PER_PAGE
        )
        const height = PADDING * 2 + pageRows.length * LINE_HEIGHT
        const png = await renderer.render(
            {
                type: 'container',
                style: {
                    width: WIDTH,
                    height,
                    position: 'relative',
                    backgroundColor: '#ffffff'
                },
                children: pageRows.map((row, index) => ({
                    type: 'text',
                    text: row,
                    style: {
                        ...style,
                        position: 'absolute',
                        left: PADDING,
                        top: PADDING + index * LINE_HEIGHT,
                        height: LINE_HEIGHT
                    }
                }))
            },
            {
                width: WIDTH,
                height,
                format: 'png',
                fontFamilies: FONT_FAMILIES,
                signal: opts.signal
            }
        )
        opts.signal?.throwIfAborted()
        requestBytes += 4 * Math.ceil(png.byteLength / 3) + 128
        if (requestBytes > MAX_REQUEST_BYTES) return undefined
        content.push({
            type: 'image_url',
            image_url: {
                url: `data:image/png;base64,${Buffer.from(png.buffer, png.byteOffset, png.byteLength).toString('base64')}`,
                detail: 'high'
            }
        })
    }
    return { content, tokens }
}
