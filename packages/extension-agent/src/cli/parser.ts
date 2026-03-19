/** @module cli/parser */

import type { AgentCliBlock, AgentCliLine } from './types'

export function parseAgentCliBlocks(text: string) {
    const blocks: AgentCliBlock[] = []
    const re = /```agentctl\s*\n?([\s\S]*?)```/gi

    for (const match of text.matchAll(re)) {
        const body = match[1]?.trim() ?? ''
        const lines = body
            .split(/\r?\n/)
            .map(parseLine)
            .filter(Boolean) as AgentCliLine[]

        if (lines.length < 1) {
            continue
        }

        blocks.push({
            raw: match[0],
            body,
            lines
        })
    }

    return blocks
}

export function parseAgentCliCommand(text: string) {
    const raw = text.trim()
    if (!raw.toLowerCase().startsWith('agentctl')) {
        return undefined
    }

    const body = raw.slice('agentctl'.length).trim() || 'help'
    const lines = body
        .split(/\r?\n/)
        .map(parseLine)
        .filter(Boolean) as AgentCliLine[]

    if (lines.length < 1) {
        return undefined
    }

    return {
        raw,
        body,
        lines
    } satisfies AgentCliBlock
}

function parseLine(raw: string) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
        return undefined
    }

    const body = line.startsWith('$ ') ? line.slice(2).trim() : line
    const argv = tokenize(body)
    if (argv.length < 1) {
        return undefined
    }

    return {
        raw: body,
        argv
    } satisfies AgentCliLine
}

export function tokenize(line: string) {
    const argv: string[] = []
    let current = ''
    let quote: 'single' | 'double' | undefined
    let escape = false

    for (let idx = 0; idx < line.length; idx++) {
        const ch = line[idx]

        if (escape) {
            current += ch
            escape = false
            continue
        }

        if (ch === '\\') {
            escape = true
            continue
        }

        if (quote === 'single') {
            if (ch === "'") {
                quote = undefined
            } else {
                current += ch
            }
            continue
        }

        if (quote === 'double') {
            if (ch === '"') {
                quote = undefined
            } else {
                current += ch
            }
            continue
        }

        if (ch === "'") {
            quote = 'single'
            continue
        }

        if (ch === '"') {
            quote = 'double'
            continue
        }

        if (/\s/.test(ch)) {
            if (current) {
                argv.push(current)
                current = ''
            }
            continue
        }

        current += ch
    }

    if (current) {
        argv.push(current)
    }

    return argv
}
