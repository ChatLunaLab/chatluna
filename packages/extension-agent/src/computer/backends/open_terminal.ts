/** @module computer/backends/open_terminal */

import { randomUUID } from 'crypto'
import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import { Context } from 'koishi'
import mimeTypes from 'mime-types'
import { buildPosixBackgroundCommand } from './types'
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
    private _home = '/'
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
        this._root = options.cwd || '~'
        this._cwd = this._root
    }

    get cwd() {
        return this._cwd
    }

    async connect() {
        if (!this.cfg.baseUrl) {
            throw new Error('open-terminal baseUrl is empty.')
        }

        const current = await this.ctx.http.post(
            this.url('/execute'),
            {
                command: 'pwd'
            },
            {
                params: {
                    wait: 5
                },
                headers: {
                    ...this.headers(),
                    'content-type': 'application/json'
                }
            }
        )
        const output = formatOpenTerminalOutput(current.data?.output)
        const root = output.stdout.trim() || '/'

        if (this.options.cwd) {
            try {
                const result = await this.ctx.http(this.url('/files/list'), {
                    method: 'GET',
                    headers: this.headers(),
                    params: {
                        directory: this.options.cwd
                    }
                })
                this._root =
                    typeof result.data?.dir === 'string'
                        ? result.data.dir
                        : this.options.cwd
                this._cwd = this._root
            } catch {
                this._root = root
                this._cwd = root
            }
        } else {
            this._root = root
            this._cwd = root
        }

        this._connected = true
    }

    async disconnect() {
        this._connected = false
    }

    isConnected() {
        return this._connected
    }

    async readFile(filePath: string, offset?: number, limit?: number) {
        try {
            const result = await this.ctx.http(this.url('/files/list'), {
                method: 'GET',
                headers: this.headers(),
                params: {
                    directory: filePath
                }
            })
            const dir =
                typeof result.data?.dir === 'string'
                    ? result.data.dir
                    : filePath
            const entries = Array.isArray(result.data?.entries)
                ? result.data.entries
                : []

            return entries
                .map((item) => {
                    if (typeof item?.name !== 'string') {
                        return undefined
                    }

                    const path = joinPath(dir, item.name)
                    return item?.type === 'directory' ? `${path}/` : path
                })
                .filter((item): item is string => item != null)
                .sort()
                .join('\n')
        } catch {}

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
            const secondIdx = content.indexOf(
                oldString,
                firstIdx + oldString.length
            )
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

        await this.ctx.http.post(
            this.url('/files/replace'),
            {
                path: filePath,
                replacements: [
                    {
                        target: oldString,
                        replacement: newString,
                        allow_multiple: replaceCount !== 1
                    }
                ]
            },
            {
                headers: {
                    ...this.headers(),
                    'content-type': 'application/json'
                }
            }
        )

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
        const params = new URLSearchParams({
            query: pattern,
            path: searchPath || this._root,
            regex: 'true',
            match_per_line: 'true',
            max_results: '500'
        })
        if (include) {
            params.append('include', include)
        }

        const result = await this.ctx.http(
            this.url(`/files/grep?${params.toString()}`),
            {
                method: 'GET',
                headers: this.headers()
            }
        )

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
        const params = new URLSearchParams({
            pattern,
            path: dir,
            type: 'file',
            max_results: '500'
        })
        const result = await this.ctx.http(
            this.url(`/files/glob?${params.toString()}`),
            {
                method: 'GET',
                headers: this.headers()
            }
        )

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
                return joinPath(dir, item.path)
            })
            .filter((item): item is string => item != null)
    }

    async execute(command: string, options: ExecuteOptions = {}) {
        const cwd = options.workdir || this._cwd
        const headers = {
            ...this.headers(),
            'content-type': 'application/json'
        }
        const result = await this.ctx.http.post(
            this.url('/execute'),
            {
                command,
                cwd,
                env: options.env
            },
            {
                params: {
                    wait: 1
                },
                headers
            }
        )

        this._cwd = cwd
        const data = result.data

        if (data?.status !== 'running') {
            const output = formatOpenTerminalOutput(data?.output)
            return {
                exitCode: data?.exitCode ?? data?.code ?? data?.exit_code ?? 0,
                stdout: output.stdout,
                stderr: output.stderr,
                signal: data?.signal,
                timedOut: false
            }
        }

        const run = createOpenTerminalPoller(
            this.ctx,
            (pathname) => this.url(pathname),
            this.headers(),
            data
        )
        const waited = await run.wait(options.timeout ?? 30000)

        return {
            exitCode:
                waited.data?.exitCode ??
                waited.data?.code ??
                waited.data?.exit_code ??
                0,
            stdout: waited.stdout,
            stderr: waited.stderr,
            signal: waited.data?.signal,
            timedOut: waited.timedOut
        }
    }

    async readAsset(filePath: string) {
        const asset = await this.openAsset(filePath)
        return (await readOpenTerminalAsset(asset.stream)).toString('base64')
    }

    async openAsset(filePath: string) {
        const url = new URL(this.url('/files/read'))
        url.searchParams.set('path', filePath)
        const result = await fetch(url, {
            headers: this.headers()
        })

        if (!result.ok || result.body == null) {
            throw new Error(`Failed to open asset: ${result.status}`)
        }

        const mimeType = result.headers.get('content-type')
        const fallback = mimeTypes.lookup(filePath)
        if (mimeType?.startsWith('application/json')) {
            const data = await result.json()
            const content =
                typeof data?.content === 'string'
                    ? data.content
                    : typeof data === 'string'
                      ? data
                      : JSON.stringify(data)
            const size = Buffer.byteLength(content)
            return {
                stream: Readable.from([Buffer.from(content, 'utf8')]),
                size,
                mimeType: fallback === false ? 'text/plain' : fallback
            }
        }

        const size = Number(result.headers.get('content-length') ?? '')
        return {
            stream: Readable.fromWeb(result.body),
            size: Number.isFinite(size) ? size : undefined,
            mimeType: mimeType ?? (fallback === false ? undefined : fallback)
        }
    }

    async createTerminal(options: TerminalOptions = {}) {
        const cwd = options.cwd || this._cwd
        const headers = {
            ...this.headers(),
            'content-type': 'application/json'
        }
        const result = await this.ctx.http.post(
            this.url('/execute'),
            {
                command: 'bash',
                cwd
            },
            {
                params: {
                    wait: 1
                },
                headers
            }
        )

        if (typeof result.data?.id !== 'string') {
            const output = formatOpenTerminalOutput(result.data?.output)
            throw new Error(
                output.stderr || output.stdout || 'Failed to create terminal.'
            )
        }

        const run = createOpenTerminalPoller(
            this.ctx,
            (pathname) => this.url(pathname),
            this.headers(),
            result.data
        )
        const callbacks = new Set<(data: string) => void>()
        const url = this.url(`/execute/${run.id}`)
        const ctx = this.ctx
        let buffer = ''
        this._cwd = cwd

        const output = formatOpenTerminalOutput(result.data?.output)
        buffer = `${output.stdout}${output.stderr}`

        const emit = (data: string) => {
            if (!data) {
                return
            }

            if (callbacks.size < 1) {
                buffer += data
                return
            }

            for (const callback of callbacks) {
                callback(data)
            }
        }
        run.start(emit)

        return {
            id: run.id,
            async onData(callback) {
                callbacks.add(callback)
                if (buffer) {
                    callback(buffer)
                    buffer = ''
                }
                return () => {
                    callbacks.delete(callback)
                }
            },
            async sendInput(data) {
                await ctx.http.post(
                    `${url}/input`,
                    {
                        input: data
                    },
                    {
                        headers
                    }
                )
            },
            async resize(_cols, _rows) {},
            async kill() {
                await run.kill()
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

type OpenTerminalData = {
    id?: string
    next_offset?: number
    output?: unknown
    status?: string
    exitCode?: number
    code?: number
    exit_code?: number
    signal?: string
}

function createOpenTerminalPoller(
    ctx: Context,
    url: (pathname: string) => string,
    headers: Record<string, string>,
    init: OpenTerminalData
) {
    if (typeof init.id !== 'string') {
        throw new Error('Failed to start open-terminal command.')
    }

    const id = init.id
    let data = init
    let nextOffset =
        typeof init.next_offset === 'number'
            ? init.next_offset
            : Array.isArray(init.output)
              ? init.output.length
              : 0
    let closed = init.status !== 'running'
    let timer: NodeJS.Timeout | undefined

    const read = async () => {
        if (closed) {
            return data
        }

        const status = await ctx.http(url(`/execute/${id}/status`), {
            method: 'GET',
            headers,
            params: {
                wait: 1,
                offset: nextOffset
            }
        })

        data = status.data
        if (typeof data.next_offset === 'number') {
            nextOffset = data.next_offset
        }
        closed = data.status !== 'running'
        return data
    }

    const kill = async () => {
        closed = true
        clearTimeout(timer)
        await ctx.http
            .delete(url(`/execute/${id}`), {
                headers
            })
            .catch(() => undefined)
    }

    return {
        id,
        start(onData: (text: string) => void) {
            const poll = async () => {
                if (closed) {
                    return
                }

                try {
                    const data = await read()
                    const output = formatOpenTerminalOutput(data.output)
                    onData(`${output.stdout}${output.stderr}`)
                } catch {
                    closed = true
                }

                if (!closed) {
                    timer = setTimeout(() => {
                        poll().catch(() => undefined)
                    }, 0)
                }
            }

            if (!closed) {
                timer = setTimeout(() => {
                    poll().catch(() => undefined)
                }, 0)
            }
        },
        async wait(timeout: number) {
            const stdout: string[] = []
            const stderr: string[] = []

            const append = (data: OpenTerminalData) => {
                const output = formatOpenTerminalOutput(data.output)
                if (output.stdout) {
                    stdout.push(output.stdout)
                }
                if (output.stderr) {
                    stderr.push(output.stderr)
                }
            }

            append(data)
            const end = Date.now() + Math.max(timeout, 0)

            while (Date.now() < end) {
                if (closed) {
                    break
                }

                append(await read())
            }

            if (!closed) {
                await kill()
                return {
                    data,
                    stdout: stdout.join(''),
                    stderr: stderr.join(''),
                    timedOut: true
                }
            }

            return {
                data,
                stdout: stdout.join(''),
                stderr: stderr.join(''),
                timedOut: false
            }
        },
        kill
    }
}

function ensureTrailingSlash(url: string) {
    return url.endsWith('/') ? url : `${url}/`
}

function joinPath(dir: string, path: string) {
    if (!dir || dir === '.') {
        return path
    }

    if (dir === '/') {
        return `/${path}`
    }

    return `${dir.replace(/\/$/, '')}/${path}`
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
