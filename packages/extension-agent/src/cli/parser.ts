/** @module cli/parser */

import { parse as parseShell, quote as quoteShell } from 'shell-quote'
import type { ControlOperator } from 'shell-quote'
import type {
    AgentCliBlock,
    AgentCliCall,
    AgentCliLine,
    AgentCliOperator
} from './types'

const SUPPORTED_OPERATORS = new Set<ControlOperator>([
    '&',
    '&&',
    '|',
    '|&',
    '||',
    ';'
])

export function parseAgentCliCommand(text: string) {
    const raw = text.trim()
    const prefix = getAgentCliPrefix(raw)
    if (!prefix) {
        return undefined
    }

    const body = raw.slice(prefix.length).trim() || 'help'
    const line = parseLine(body)
    if (!line) {
        return undefined
    }

    return {
        raw,
        body,
        lines: [line]
    } satisfies AgentCliBlock
}

export function getAgentCliPrefix(text: string) {
    const raw = text.trim().toLowerCase()

    if (raw === 'agentcli' || raw.startsWith('agentcli ')) {
        return 'agentcli'
    }

    return undefined
}

function parseLine(raw: string) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) {
        return undefined
    }

    const body = line.startsWith('$ ') ? line.slice(2).trim() : line
    const calls = tokenize(body)
    if (calls.length < 1) {
        return undefined
    }

    return {
        raw: body,
        calls
    } satisfies AgentCliLine
}

export function tokenize(line: string) {
    const entries = parseShell(line)
    const calls: AgentCliCall[] = []
    let argv: string[] = []

    for (const entry of entries) {
        if (typeof entry === 'string') {
            argv.push(entry)
            continue
        }

        if ('comment' in entry) {
            break
        }

        if (entry.op === 'glob') {
            argv.push(entry.pattern)
            continue
        }

        if (!SUPPORTED_OPERATORS.has(entry.op)) {
            throw new Error(`Unsupported operator: ${entry.op}`)
        }

        pushCall(calls, argv, entry.op as AgentCliOperator)
        argv = []
    }

    pushCall(calls, argv)
    return calls
}

function pushCall(
    calls: AgentCliCall[],
    rawArgv: string[],
    join?: AgentCliOperator
) {
    const argv = rawArgv[0] === 'agentcli' ? rawArgv.slice(1) : rawArgv
    if (argv.length < 1) {
        if (!join && rawArgv[0] === 'agentcli') {
            calls.push({ raw: 'agentcli help', argv: ['help'] })
            return
        }

        throw new Error('Invalid command chain')
    }

    calls.push({
        raw: `agentcli ${quoteShell(argv)}`,
        argv,
        join
    })
}

export function isAgentCliHelpFlag(arg: string) {
    return arg === '-h' || arg === '--help'
}

export function normalizeAgentCliArgv(argv: string[]) {
    const idx = argv.findIndex(isAgentCliHelpFlag)
    if (idx < 0) {
        return argv
    }

    if (idx === 0) {
        return [
            'help',
            ...argv.slice(1).filter((arg) => !isAgentCliHelpFlag(arg))
        ]
    }

    return ['help', ...argv.slice(0, idx)]
}
