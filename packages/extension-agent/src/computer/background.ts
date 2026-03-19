import {
    ComputerBackendType,
    ComputerBackgroundJobInfo,
    ComputerBackgroundJobState
} from '../types'
import { TerminalHandle } from './types'

export interface ManagedTerminal {
    terminal: TerminalHandle
    persistent: boolean
    token: string
}

export interface BackgroundJob {
    id: string
    sessionId: string
    terminalId: string
    backend: ComputerBackendType
    url: string
    token: string
    command: string
    cwd: string
    state: ComputerBackgroundJobState
    startedAt: number
    endedAt?: number
    timeout?: number
    exitCode?: number
    output: string
    marker: string
    pending: string
    offData?: () => void
    timer?: NodeJS.Timeout
}

export function toBackgroundJobInfo(
    job: BackgroundJob
): ComputerBackgroundJobInfo {
    return {
        id: job.id,
        sessionId: job.sessionId,
        terminalId: job.terminalId,
        backend: job.backend,
        url: job.url,
        token: job.token,
        command: job.command,
        cwd: job.cwd,
        state: job.state,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        timeout: job.timeout,
        exitCode: job.exitCode,
        output: job.output
    }
}

export function appendBackgroundOutput(current: string, data: string) {
    const next = current + data
    if (next.length <= 16000) {
        return next
    }

    return next.slice(next.length - 16000)
}

export function readBackgroundExit(
    pending: string,
    data: string,
    marker: string
) {
    const text = `${pending}${data}`
    const lines = text.split(/\r?\n/)
    const rest = lines.pop() ?? ''

    for (const line of lines) {
        if (!line.startsWith(`${marker}:`)) {
            continue
        }

        const code = Number(line.slice(marker.length + 1))
        return {
            pending: rest,
            exitCode: Number.isNaN(code) ? 1 : code
        }
    }

    return { pending: rest }
}

export function stripBackgroundMarker(output: string, marker: string) {
    const lines = output.split('\n')
    return lines
        .filter((line) => !line.includes(`${marker}:`))
        .join('\n')
        .replace(/\n+$/, '\n')
}
