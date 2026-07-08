import { graphemeSegments } from 'unicode-segmenter/grapheme'
import type { SplitMode } from '../types'

export function splitText(text: string, mode: SplitMode = 'none') {
    if (mode === 'none') return [text]

    if (mode === 'paragraph') {
        return text
            .split(/\n\n+/)
            .map((part) => part.trim())
            .filter(Boolean)
    }

    const result: string[] = []
    let buf = text

    while (buf) {
        const end = nextTextCut(buf, true)
        if (end === -1) break

        const content = buf.slice(0, end).trim()
        if (content) result.push(content)
        buf = buf.slice(end)
    }

    if (buf.trim()) result.push(buf.trim())
    return result
}

export function nextTextCut(text: string, flush: boolean) {
    const parts = Array.from(graphemeSegments(text))
    const match = /\n\n+/.exec(text)
    const end = sentenceCut(text, parts, flush)
    if (end !== -1 && match != null) {
        return Math.min(end, match.index + match[0].length)
    }
    if (end !== -1) return end
    if (match != null) return match.index + match[0].length

    return softCut(text, parts)
}

function sentenceCut(text: string, parts: Segment[], flush: boolean) {
    for (let idx = 0; idx < parts.length; idx++) {
        if (!isEnd(text, parts, idx)) continue

        let endIdx = idx + 1
        while (endIdx < parts.length && isEnd(text, parts, endIdx)) endIdx++
        while (
            endIdx < parts.length &&
            CLOSE_CHARS.includes(parts[endIdx].segment)
        ) {
            endIdx++
        }

        let nextIdx = endIdx
        while (nextIdx < parts.length && isSpace(parts[nextIdx].segment)) {
            nextIdx++
        }
        if (
            nextIdx < parts.length &&
            /\p{Extended_Pictographic}/u.test(parts[nextIdx].segment)
        ) {
            endIdx = nextIdx + 1
            while (
                endIdx < parts.length &&
                /\p{Extended_Pictographic}/u.test(parts[endIdx].segment)
            ) {
                endIdx++
            }
        }

        const end = parts[endIdx]?.index ?? text.length

        if (isOpen(text, end)) continue

        if (end === text.length) return flush ? end : -1

        if (isSpace(parts[endIdx].segment)) {
            while (endIdx < parts.length && isSpace(parts[endIdx].segment)) {
                endIdx++
            }
            if (endIdx >= parts.length) return flush ? text.length : -1
            return parts[endIdx]?.index ?? text.length
        }

        if (
            parts[idx].segment !== '.' ||
            OPEN_CHARS.includes(parts[endIdx].segment) ||
            isCjk(parts[endIdx].segment) ||
            isUpper(parts[endIdx].segment)
        ) {
            return end
        }
    }

    return -1
}

function softCut(text: string, parts: Segment[]) {
    if (parts.length < SOFT_LEN) return -1

    for (
        let idx = Math.min(parts.length - 1, HARD_LEN - 1);
        idx >= MIN_SOFT_LEN;
        idx--
    ) {
        if (!SOFT_CHARS.includes(parts[idx].segment)) continue
        let endIdx = idx + 1
        while (
            endIdx < parts.length &&
            CLOSE_CHARS.includes(parts[endIdx].segment)
        ) {
            endIdx++
        }
        const end = parts[endIdx]?.index ?? text.length
        if (isOpen(text, end)) continue
        return end
    }

    if (parts.length < HARD_LEN) return -1

    for (let idx = HARD_LEN - 1; idx >= MIN_SOFT_LEN; idx--) {
        if (isSpace(parts[idx].segment) && !isOpen(text, parts[idx].index)) {
            return parts[idx + 1]?.index ?? text.length
        }
    }

    return parts[HARD_LEN]?.index ?? text.length
}

function isEnd(text: string, parts: Segment[], idx: number) {
    const char = parts[idx].segment
    if (char === '.') return dotEnds(text, parts, idx)
    if (
        char === '。' &&
        (parts[idx - 1]?.segment === '。' || parts[idx + 1]?.segment === '。')
    ) {
        return false
    }
    return END_CHARS.includes(char)
}

function dotEnds(text: string, parts: Segment[], idx: number) {
    const prev = parts[idx - 1]?.segment
    const next = parts[idx + 1]?.segment

    if (next === '.' || prev === '.') return false
    if (isDigit(prev) && isDigit(next)) return false

    const word = text
        .slice(0, parts[idx].index)
        .match(/[A-Za-z.]+$/)?.[0]
        .toLowerCase()
    if (word && DOT_WORDS.has(word)) return false
    if (word && /^(?:[a-z]\.)+[a-z]$/i.test(word)) return false
    if (word && /^[a-z]$/i.test(word)) return false

    return true
}

function isDigit(char?: string) {
    return char != null && /[0-9]/.test(char)
}

function isSpace(char: string) {
    return /\s/.test(char)
}

function isCjk(char: string) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(char)
}

function isUpper(char: string) {
    return /[A-Z]/.test(char)
}

function isOpen(text: string, end: number) {
    const stack: string[] = []

    for (const char of text.slice(0, end)) {
        if (char === '"') {
            if (stack[stack.length - 1] === char) stack.pop()
            else stack.push(char)
            continue
        }

        if (OPEN_CLOSE.has(char)) {
            stack.push(OPEN_CLOSE.get(char)!)
            continue
        }

        if (stack[stack.length - 1] === char) stack.pop()
    }

    return stack.length > 0
}

const SOFT_LEN = 96
const HARD_LEN = 160
const MIN_SOFT_LEN = 48
const END_CHARS = '。！？!?'
const SOFT_CHARS = '，,；;：:、'
const CLOSE_CHARS = '”’"）)]】}》〉」』'
const OPEN_CHARS = '“‘"（([【{《〈「『'
const OPEN_CLOSE = new Map<string, string>([
    ['“', '”'],
    ['‘', '’'],
    ['（', '）'],
    ['(', ')'],
    ['[', ']'],
    ['【', '】'],
    ['{', '}'],
    ['《', '》'],
    ['〈', '〉'],
    ['「', '」'],
    ['『', '』']
])
const DOT_WORDS = new Set([
    'mr',
    'mrs',
    'ms',
    'dr',
    'prof',
    'sr',
    'jr',
    'st',
    'vs',
    'etc',
    'fig',
    'no',
    'vol',
    'inc',
    'ltd',
    'co',
    'corp',
    'e.g',
    'i.e'
])

type Segment = { segment: string; index: number }
