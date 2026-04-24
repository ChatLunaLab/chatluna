export interface DslCall {
    verb: string
    positional: DslValue[]
    named: Record<string, DslValue>
}

export type DslValue =
    | string
    | number
    | boolean
    | { kind: 'duration'; ms: number }
    | { kind: 'ident'; name: string }

interface Token {
    type:
        | 'LPAREN'
        | 'RPAREN'
        | 'COMMA'
        | 'EQ'
        | 'STRING'
        | 'NUMBER'
        | 'IDENT'
        | 'DURATION'
        | 'EOF'
    pos: number
    value?: string | number | boolean | { kind: 'duration'; ms: number }
}

export function parseDsl(src: string): DslCall {
    const tokens = lex(src)
    let idx = 0
    const peek = () => tokens[idx]
    const take = () => tokens[idx++]
    const need = (type: Token['type']) => {
        const token = take()
        if (token.type !== type) {
            throw new Error(`Expected ${type} at ${token.pos}`)
        }
        return token
    }

    const verbToken = need('IDENT')
    if (typeof verbToken.value !== 'string') {
        throw new Error(`Expected verb identifier at ${verbToken.pos}`)
    }
    const verb = verbToken.value
    need('LPAREN')

    const positional: DslValue[] = []
    const named: Record<string, DslValue> = {}
    let sawNamed = false

    if (peek().type !== 'RPAREN') {
        while (true) {
            if (peek().type === 'IDENT' && tokens[idx + 1]?.type === 'EQ') {
                sawNamed = true
                const token = take()
                if (typeof token.value !== 'string') {
                    throw new Error(`Expected named argument at ${token.pos}`)
                }
                const key = token.value
                take()
                named[key] = readValue(take())
            } else {
                if (sawNamed) {
                    throw new Error(
                        `Positional argument after named argument at ${peek().pos}`
                    )
                }
                positional.push(readValue(take()))
            }

            if (peek().type !== 'COMMA') break
            take()
        }
    }

    need('RPAREN')
    if (peek().type !== 'EOF') {
        throw new Error(`Unexpected token at ${peek().pos}`)
    }

    return { verb, positional, named }
}

export function valueToString(v: DslValue): string {
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (v.kind === 'ident') return v.name
    return String(v.ms)
}

export function valueToNumber(v: DslValue): number {
    if (typeof v === 'number') return v
    throw new Error('Expected number')
}

export function valueToDurationMs(v: DslValue): number {
    if (typeof v === 'object' && 'kind' in v && v.kind === 'duration') {
        return v.ms
    }
    throw new Error('Expected duration')
}

export function valueToIdent(v: DslValue): string {
    if (typeof v === 'object' && 'kind' in v && v.kind === 'ident') {
        return v.name
    }
    throw new Error('Expected identifier')
}

function lex(src: string): Token[] {
    const tokens: Token[] = []
    let idx = 0

    while (idx < src.length) {
        const ch = src[idx]
        if (/\s/.test(ch)) {
            idx++
            continue
        }
        if (ch === '(') {
            tokens.push({ type: 'LPAREN', pos: idx })
            idx++
            continue
        }
        if (ch === ')') {
            tokens.push({ type: 'RPAREN', pos: idx })
            idx++
            continue
        }
        if (ch === ',') {
            tokens.push({ type: 'COMMA', pos: idx })
            idx++
            continue
        }
        if (ch === '=') {
            tokens.push({ type: 'EQ', pos: idx })
            idx++
            continue
        }
        if (ch === '"') {
            const pos = idx
            let value = ''
            idx++
            while (idx < src.length) {
                if (src[idx] === '"') {
                    idx++
                    tokens.push({ type: 'STRING', pos, value })
                    break
                }
                if (src[idx] === '\\') {
                    const next = src[idx + 1]
                    if (next !== '"' && next !== '\\') {
                        throw new Error(`Invalid escape at ${idx}`)
                    }
                    value += next
                    idx += 2
                    continue
                }
                value += src[idx]
                idx++
            }
            if (tokens[tokens.length - 1]?.pos !== pos) {
                throw new Error(`Unterminated string at ${pos}`)
            }
            continue
        }
        if (/\d/.test(ch) || (ch === '-' && /\d/.test(src[idx + 1] ?? ''))) {
            const pos = idx
            if (ch === '-') idx++
            while (/\d/.test(src[idx] ?? '')) idx++
            if (src[idx] === '.') {
                idx++
                while (/\d/.test(src[idx] ?? '')) idx++
            }
            const raw = src.slice(pos, idx)
            const unit = src[idx]
            if (unit === 's' || unit === 'm' || unit === 'h' || unit === 'd') {
                idx++
                const value = Number(raw)
                let ms = value * 1000
                switch (unit) {
                    case 'm':
                        ms = value * 60 * 1000
                        break
                    case 'h':
                        ms = value * 60 * 60 * 1000
                        break
                    case 'd':
                        ms = value * 24 * 60 * 60 * 1000
                        break
                }
                tokens.push({
                    type: 'DURATION',
                    pos,
                    value: {
                        kind: 'duration',
                        ms
                    }
                })
                continue
            }
            tokens.push({ type: 'NUMBER', pos, value: Number(raw) })
            continue
        }
        if (/[A-Za-z_]/.test(ch)) {
            const pos = idx
            while (/[A-Za-z0-9_\-]/.test(src[idx] ?? '')) idx++
            const value = src.slice(pos, idx)
            tokens.push({
                type: 'IDENT',
                pos,
                value:
                    value === 'true' ? true : value === 'false' ? false : value
            })
            continue
        }
        throw new Error(`Unexpected character at ${idx}`)
    }

    tokens.push({ type: 'EOF', pos: src.length })
    return tokens
}

function readValue(token: Token): DslValue {
    if (token.type === 'STRING') return token.value as string
    if (token.type === 'NUMBER') return token.value as number
    if (token.type === 'DURATION') {
        return token.value as { kind: 'duration'; ms: number }
    }
    if (token.type === 'IDENT') {
        if (typeof token.value === 'boolean') return token.value
        return { kind: 'ident', name: token.value as string }
    }
    throw new Error(`Expected value at ${token.pos}`)
}
