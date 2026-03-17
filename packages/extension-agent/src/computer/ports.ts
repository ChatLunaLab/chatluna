/** @module computer/ports */

import { PortInfo } from './types'

export function parsePorts(output: string) {
    const lines = output.split('\n')
    const result: PortInfo[] = []

    for (const line of lines) {
        const port = line.match(/[:.]([0-9]{2,5})\s+/)
        if (!port) {
            continue
        }

        const state =
            /ESTAB/i.test(line) || /ESTABLISHED/i.test(line)
                ? 'established'
                : /LISTEN/i.test(line) || /LISTENING/i.test(line)
                  ? 'listening'
                  : undefined
        if (!state) {
            continue
        }

        const value = Number(port[1])
        if (
            result.some((item) => item.port === value && item.state === state)
        ) {
            continue
        }

        result.push({
            port: value,
            state,
            process: line.trim()
        })
    }

    return result.sort((a, b) => a.port - b.port)
}
