type Child = RawHtml | string | number | boolean | null | undefined | Child[]
type Props = Record<string, unknown> & { children?: Child }
type NodeType = string | typeof Fragment

export interface RawHtml {
    __html: string
}

export const Fragment = Symbol('Fragment')

export function raw(value: string): RawHtml {
    return { __html: value }
}

export function renderHtml(value: Child) {
    return render(value)
}

export function jsx(type: NodeType, props: Props = {}, _key?: string): RawHtml {
    if (type === Fragment) return raw(render(props.children))

    const attrs = Object.entries(props)
        .filter(([key]) => key !== 'children')
        .map(([key, value]) => attr(key, value))
        .join('')

    return raw(`<${type}${attrs}>${render(props.children)}</${type}>`)
}

export const jsxs = jsx

function attr(key: string, value: unknown) {
    if (value == null || value === false) return ''
    if (value === true) return ` ${key}`
    return ` ${key}="${escapeHtml(String(value))}"`
}

function render(value: Child): string {
    if (Array.isArray(value)) return value.map((item) => render(item)).join('')
    if (value == null || value === false || value === true) return ''
    if (isRaw(value)) return value.__html
    return escapeHtml(String(value))
}

function isRaw(value: unknown): value is RawHtml {
    return typeof value === 'object' && value !== null && '__html' in value
}

function escapeHtml(value: string) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
    export type Element = RawHtml

    export interface IntrinsicElements {
        [name: string]: Record<string, unknown>
    }
}
