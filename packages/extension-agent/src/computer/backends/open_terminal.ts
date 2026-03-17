/** @module computer/backends/open_terminal */

import { randomUUID } from 'crypto'
import { Context } from 'koishi'
import { parsePorts } from '../ports'
import { quoteShell } from './types'
import { OpenTerminalBackendConfig } from '../../types'
import {
    ComputerSessionApi,
    ExecuteOptions,
    ScreenshotResult,
    StreamHandle,
    TerminalHandle,
    TerminalOptions
} from '../types'

export class OpenTerminalComputerSession implements ComputerSessionApi {
    readonly backend = 'open-terminal' as const
    readonly sessionId: string
    readonly capabilities = [...CAPABILITIES]

    private _connected = false
    private _cwd: string
    private _headers?: Record<string, string>

    constructor(
        private ctx: Context,
        private cfg: OpenTerminalBackendConfig,
        private options: { userId?: string; cwd?: string },
        id = randomUUID()
    ) {
        this.sessionId = id
        this._cwd = options.cwd || '/workspace'
    }

    get cwd() {
        return this._cwd
    }

    async connect() {
        if (!this.cfg.baseUrl) {
            throw new Error('open-terminal baseUrl is empty.')
        }

        await this.ctx.http(this.url('/ports'), {
            method: 'GET',
            headers: this.headers()
        })
        this._connected = true
    }

    async disconnect() {
        this._connected = false
    }

    isConnected() {
        return this._connected
    }

    async readFile(filePath: string, offset?: number, limit?: number) {
        const result = await this.ctx.http(
            this.url(`/files/${encodeRemotePath(filePath)}`),
            {
                method: 'GET',
                headers: this.headers()
            }
        )

        const value = result.data
        const text =
            typeof value === 'string'
                ? value
                : typeof value?.content === 'string'
                  ? value.content
                  : typeof value?.data === 'string'
                    ? value.data
                    : JSON.stringify(value)

        if (offset == null && limit == null) {
            return text
        }

        const lines = text.split('\n')
        const start = offset != null ? Math.max(0, offset - 1) : 0
        const end =
            limit != null ? Math.min(lines.length, start + limit) : lines.length
        const resultLines = lines
            .slice(start, end)
            .map((line, idx) => `${start + idx + 1}: ${line}`)
        if (end >= lines.length) {
            return resultLines.join('\n')
        }

        return `${resultLines.join('\n')}\n\n(Showing lines ${start + 1}-${end} of ${lines.length}. Use offset=${end + 1} to continue.)`
    }

    async writeFile(filePath: string, content: string) {
        await this.ctx.http.post(
            this.url(`/files/${encodeRemotePath(filePath)}`),
            content,
            {
                headers: {
                    ...this.headers(),
                    'content-type': 'text/plain; charset=utf-8'
                }
            }
        )
    }

    async editFile(
        filePath: string,
        oldString: string,
        newString: string,
        replaceCount?: number
    ) {
        const content = await this.readFile(filePath)
        if (!content.includes(oldString)) {
            return { success: false, context: '', replacements: 0 }
        }

        if (replaceCount === 1) {
            const firstIdx = content.indexOf(oldString)
            const secondIdx = content.indexOf(oldString, firstIdx + 1)
            if (secondIdx !== -1) {
                throw new Error(
                    `Found multiple matches for oldString in ${filePath}. Provide more surrounding lines in oldString to identify the correct match, or set replaceAll to change every instance.`
                )
            }
        }

        let replacements = 0
        const next = content.replaceAll(oldString, (match) => {
            if (replaceCount != null && replacements >= replaceCount) {
                return match
            }
            replacements += 1
            return newString
        })

        await this.writeFile(filePath, next)
        const lines = next.split('\n')
        const row = lines.findIndex((line) => line.includes(newString))
        const start = Math.max(0, row - 10)
        const end = Math.min(lines.length, row + 11)

        return {
            success: true,
            replacements,
            context: lines
                .slice(start, end)
                .map(
                    (line, idx) =>
                        `${start + idx + 1 === row + 1 ? '>' : ' '} ${start + idx + 1}: ${line}`
                )
                .join('\n')
        }
    }

    async grep(pattern: string, searchPath?: string, include?: string) {
        const dir = searchPath || this._cwd
        const cmd = include
            ? `find ${quoteShell(dir)} -type f | grep -E ${quoteShell(include)} | xargs -r grep -nE ${quoteShell(pattern)}`
            : `grep -R -nE ${quoteShell(pattern)} ${quoteShell(dir)}`
        const result = await this.execute(cmd)
        return [result.stdout, result.stderr]
            .filter(Boolean)
            .join('\n')
            .split('\n')
            .filter(Boolean)
    }

    async glob(pattern: string, searchPath?: string) {
        const dir = searchPath || this._cwd
        const result = await this.execute(
            `find ${quoteShell(dir)} -type f | grep -E ${quoteShell(pattern)}`
        )
        return [result.stdout, result.stderr]
            .filter(Boolean)
            .join('\n')
            .split('\n')
            .filter(Boolean)
    }

    async execute(command: string, options: ExecuteOptions = {}) {
        const result = await this.ctx.http.post(
            this.url('/execute'),
            {
                command,
                workdir: options.workdir || this._cwd,
                timeout: options.timeout
            },
            {
                headers: {
                    ...this.headers(),
                    'content-type': 'application/json'
                }
            }
        )

        this._cwd = options.workdir || this._cwd
        const data = result.data

        return {
            exitCode: data?.exitCode ?? data?.code ?? data?.exit_code ?? 0,
            stdout: data?.stdout ?? data?.output ?? '',
            stderr: data?.stderr ?? data?.error ?? '',
            signal: data?.signal,
            timedOut: data?.timedOut === true
        }
    }

    async createTerminal(options: TerminalOptions = {}) {
        const result = await this.ctx.http.post(
            this.url('/terminals'),
            {
                cwd: options.cwd || this._cwd,
                cols: options.cols,
                rows: options.rows
            },
            {
                headers: {
                    ...this.headers(),
                    'content-type': 'application/json'
                }
            }
        )

        const id = result.data?.id ?? result.data?.terminalId ?? randomUUID()
        const socket = this.ctx.http.ws(this.url(`/terminals/${id}/ws`), {
            headers: this.headers()
        })
        const callbacks = new Set<(data: string) => void>()

        socket.onopen = () => {
            if (this.resolveSecret(this.cfg.apiKey)) {
                socket.send(
                    JSON.stringify({
                        token: this.resolveSecret(this.cfg.apiKey)
                    })
                )
            }
        }
        socket.onmessage = (event) => {
            const data = event.data
            const text = typeof data === 'string' ? data : ''
            for (const callback of callbacks) {
                callback(text)
            }
        }

        return {
            id,
            async onData(callback) {
                callbacks.add(callback)
            },
            async sendInput(data) {
                socket.send(data)
            },
            async resize(cols, rows) {
                socket.send(JSON.stringify({ type: 'resize', cols, rows }))
            },
            async kill() {
                socket.close()
            }
        } satisfies TerminalHandle
    }

    async listPorts() {
        const result = await this.ctx.http(this.url('/ports'), {
            method: 'GET',
            headers: this.headers()
        })
        if (Array.isArray(result.data)) {
            return result.data.map((item) => ({
                port: Number(item.port),
                state:
                    item.state === 'established'
                        ? ('established' as const)
                        : ('listening' as const),
                process: item.process
            }))
        }

        return parsePorts(JSON.stringify(result.data))
    }

    getProxyUrl(port: number) {
        return this.url(`/proxy/${port}`)
    }

    async getDesktopInfo() {
        return undefined
    }

    async screenshot(): Promise<ScreenshotResult> {
        throw new Error('Desktop is not supported by open-terminal.')
    }

    async desktopAction() {
        throw new Error('Desktop is not supported by open-terminal.')
    }

    async getDesktopStream(): Promise<StreamHandle | undefined> {
        return undefined
    }

    isInScope() {
        return true
    }

    getScopePath() {
        return this._cwd
    }

    private headers() {
        if (this._headers) {
            return this._headers
        }

        const headers: Record<string, string> = {}
        const apiKey = this.resolveSecret(this.cfg.apiKey)
        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`
        }
        if (this.options.userId) {
            headers['X-User-Id'] = this.options.userId
        }

        this._headers = headers
        return headers
    }

    private url(pathname: string) {
        return new URL(
            pathname,
            ensureTrailingSlash(this.cfg.baseUrl)
        ).toString()
    }

    private resolveSecret(value: string) {
        if (!value.startsWith('env:')) {
            return value
        }

        return process.env[value.slice(4)] ?? ''
    }
}

function encodeRemotePath(filePath: string) {
    const normalized = filePath.replaceAll('\\', '/')
    return normalized
        .split('/')
        .map((item) => encodeURIComponent(item))
        .join('/')
}

function ensureTrailingSlash(url: string) {
    return url.endsWith('/') ? url : `${url}/`
}

const CAPABILITIES = [
    'file_read',
    'file_write',
    'file_edit',
    'grep',
    'glob',
    'bash',
    'terminal_pty',
    'port_preview'
] as const
