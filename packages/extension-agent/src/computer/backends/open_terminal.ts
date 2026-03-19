/** @module computer/backends/open_terminal */

import { randomUUID } from 'crypto'
import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import { Context } from 'koishi'
import mimeTypes from 'mime-types'
import { buildPosixBackgroundCommand, quoteShell } from './types'
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
    private _root: string
    private _cwd: string
    private _headers?: Record<string, string>

    constructor(
        private ctx: Context,
        private cfg: OpenTerminalBackendConfig,
        private options: { userId?: string; cwd?: string },
        id = randomUUID()
    ) {
        this.sessionId = id
        this._root = options.cwd || '/workspace'
        this._cwd = this._root
    }

    get cwd() {
        return this._cwd
    }

    async connect() {
        if (!this.cfg.baseUrl) {
            throw new Error('open-terminal baseUrl is empty.')
        }

        await this.execute('pwd', { timeout: 5000 })
        this._connected = true
    }

    async disconnect() {
        this._connected = false
    }

    isConnected() {
        return this._connected
    }

    async readFile(filePath: string, offset?: number, limit?: number) {
        const stat = await this.execute(
            `if [ -d ${quoteShell(filePath)} ]; then printf __dir__; fi`,
            { timeout: 5000 }
        )
        if (stat.stdout.trim() === '__dir__') {
            const result = await this.execute(
                `find ${quoteShell(filePath)} -mindepth 1 -maxdepth 1 \\( -type d -printf '%p/\\n' -o -type f -printf '%p\\n' \\) | sort`
            )
            return result.stdout.trim()
        }

        const params = new URLSearchParams({ path: filePath })
        if (offset != null) {
            params.set('start_line', String(offset))
        }
        if (limit != null) {
            params.set(
                'end_line',
                String(offset != null ? offset + limit - 1 : limit)
            )
        }

        const result = await this.ctx.http(
            this.url(`/files/read?${params.toString()}`),
            {
                method: 'GET',
                headers: this.headers()
            }
        )

        const text =
            typeof result.data?.content === 'string'
                ? result.data.content
                : typeof result.data === 'string'
                  ? result.data
                  : JSON.stringify(result.data)

        if (offset == null && limit == null) {
            return text
        }

        const start = offset ?? 1
        const lines = text.split('\n')
        const resultLines = lines.map((line, idx) => `${start + idx}: ${line}`)
        const total =
            typeof result.data?.total_lines === 'number'
                ? result.data.total_lines
                : start + lines.length - 1
        if (start + lines.length - 1 >= total) {
            return resultLines.join('\n')
        }

        return `${resultLines.join('\n')}\n\n(Showing lines ${start}-${start + lines.length - 1} of ${total}. Use offset=${start + lines.length} to continue.)`
    }

    async writeFile(filePath: string, content: string) {
        await this.ctx.http.post(
            this.url('/files/write'),
            {
                path: filePath,
                content
            },
            {
                headers: {
                    ...this.headers(),
                    'content-type': 'application/json'
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
                    `Found multiple matches for oldString in ${filePath}. ` +
                        'Provide more surrounding lines in oldString to identify the correct match, or set replaceAll to change every instance.'
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
        const result = await this.ctx.http(this.url('/files/grep'), {
            method: 'GET',
            headers: this.headers(),
            params: {
                query: pattern,
                path: searchPath || this._root,
                regex: true,
                include: include ? [include] : undefined,
                match_per_line: true,
                max_results: 500
            }
        })

        const matches = Array.isArray(result.data?.matches)
            ? result.data.matches
            : []

        return matches
            .map((item) => {
                if (typeof item?.file !== 'string') {
                    return undefined
                }
                if (typeof item?.line === 'number') {
                    return `${item.file}:${item.line}: ${item.content ?? ''}`
                }
                return item.file
            })
            .filter((item): item is string => item != null)
    }

    async glob(pattern: string, searchPath?: string) {
        const dir = searchPath || this._root
        const result = await this.ctx.http(this.url('/files/glob'), {
            method: 'GET',
            headers: this.headers(),
            params: {
                pattern,
                path: dir,
                type: 'file',
                max_results: 500
            }
        })

        const matches = Array.isArray(result.data?.matches)
            ? result.data.matches
            : []

        return matches
            .map((item) => {
                if (typeof item?.path !== 'string') {
                    return undefined
                }
                if (item.path.startsWith('/')) {
                    return item.path
                }
                return `${dir.replace(/\/$/, '')}/${item.path}`
            })
            .filter((item): item is string => item != null)
    }

    async execute(command: string, options: ExecuteOptions = {}) {
        const wait = Math.max(1, Math.ceil((options.timeout ?? 30000) / 1000))
        const result = await this.ctx.http.post(
            this.url('/execute'),
            {
                command,
                cwd: options.workdir || this._cwd,
                env: options.env
            },
            {
                params: {
                    wait
                },
                headers: {
                    ...this.headers(),
                    'content-type': 'application/json'
                }
            }
        )

        this._cwd = options.workdir || this._cwd
        const data = result.data
        const output = formatOpenTerminalOutput(data?.output)

        if (data?.status === 'running') {
            if (typeof data?.id === 'string') {
                await this.ctx.http
                    .delete(this.url(`/execute/${data.id}`), {
                        headers: this.headers()
                    })
                    .catch(() => undefined)
            }

            return {
                exitCode: data?.exit_code ?? 1,
                stdout: output.stdout,
                stderr: output.stderr,
                timedOut: true
            }
        }

        return {
            exitCode: data?.exitCode ?? data?.code ?? data?.exit_code ?? 0,
            stdout: output.stdout,
            stderr: output.stderr,
            signal: data?.signal,
            timedOut: false
        }
    }

    async readAsset(filePath: string) {
        const asset = await this.openAsset(filePath)
        return (await readOpenTerminalAsset(asset.stream)).toString('base64')
    }

    async openAsset(filePath: string) {
        const url = new URL(this.url('/files/view'))
        url.searchParams.set('path', filePath)
        const result = await fetch(url, {
            headers: this.headers()
        })

        if (!result.ok || result.body == null) {
            throw new Error(`Failed to open asset: ${result.status}`)
        }

        const size = Number(result.headers.get('content-length') ?? '')
        const mimeType = result.headers.get('content-type')
        const fallback = mimeTypes.lookup(filePath)
        return {
            stream: Readable.fromWeb(result.body),
            size: Number.isFinite(size) ? size : undefined,
            mimeType: mimeType ?? (fallback === false ? undefined : fallback)
        }
    }

    async createTerminal(options: TerminalOptions = {}) {
        const result = await this.ctx.http(this.url('/api/terminals'), {
            method: 'POST',
            headers: this.headers()
        })

        const id = result.data?.id ?? randomUUID()
        const socket = this.ctx.http.ws(this.url(`/api/terminals/${id}`))
        const callbacks = new Set<(data: string) => void>()
        const headers = this.headers()
        const apiKey = this.resolveSecret(this.cfg.apiKey)
        const url = this.url(`/api/terminals/${id}`)
        const ctx = this.ctx
        if (options.cwd) {
            this._cwd = options.cwd
        }

        socket.onopen = () => {
            if (apiKey) {
                socket.send(JSON.stringify({ type: 'auth', token: apiKey }))
            }
            if (options.cols != null && options.rows != null) {
                socket.send(
                    JSON.stringify({
                        type: 'resize',
                        cols: options.cols,
                        rows: options.rows
                    })
                )
            }
            if (options.cwd) {
                socket.send(
                    Buffer.from(`cd ${quoteShell(options.cwd)}\n`, 'utf8')
                )
            }
        }
        socket.onmessage = (event) => {
            const data = event.data
            const text =
                typeof data === 'string'
                    ? data
                    : Buffer.isBuffer(data)
                      ? data.toString('utf8')
                      : data instanceof ArrayBuffer
                        ? Buffer.from(data).toString('utf8')
                        : ''
            for (const callback of callbacks) {
                callback(text)
            }
        }

        return {
            id,
            async onData(callback) {
                callbacks.add(callback)
                return () => {
                    callbacks.delete(callback)
                }
            },
            async sendInput(data) {
                socket.send(Buffer.from(data, 'utf8'))
            },
            async resize(cols, rows) {
                socket.send(JSON.stringify({ type: 'resize', cols, rows }))
            },
            async kill() {
                socket.close()
                await ctx.http
                    .delete(url, {
                        headers
                    })
                    .catch(() => undefined)
            }
        } satisfies TerminalHandle
    }

    async prepareBackgroundCommand(
        command: string,
        marker: string,
        _options: ExecuteOptions = {}
    ) {
        return buildPosixBackgroundCommand(command, marker)
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
        return this._root
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

function ensureTrailingSlash(url: string) {
    return url.endsWith('/') ? url : `${url}/`
}

function formatOpenTerminalOutput(output: unknown) {
    const stdout: string[] = []
    const stderr: string[] = []

    if (!Array.isArray(output)) {
        return { stdout: '', stderr: '' }
    }

    for (const item of output) {
        const data = typeof item?.data === 'string' ? item.data : ''
        if (!data) {
            continue
        }

        if (item?.type === 'stderr') {
            stderr.push(data)
            continue
        }

        stdout.push(data)
    }

    return {
        stdout: stdout.join(''),
        stderr: stderr.join('')
    }
}

async function readOpenTerminalAsset(stream: Readable) {
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
}

const CAPABILITIES = [
    'file_read',
    'file_write',
    'file_publish',
    'file_edit',
    'grep',
    'glob',
    'bash',
    'terminal_pty'
] as const
