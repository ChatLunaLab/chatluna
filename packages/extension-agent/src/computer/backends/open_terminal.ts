/** @module computer/backends/open_terminal */

import { randomUUID } from 'crypto'
import { Buffer } from 'node:buffer'
import { posix } from 'path'
import { Readable } from 'node:stream'
import { Context } from 'koishi'
import mimeTypes from 'mime-types'
import { quoteShell } from './types'
import { OpenTerminalBackendConfig } from '../../types'
import {
    ComputerSessionApi,
    ExecuteOptions,
    FileContent,
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

        const current = readOpenTerminalData<OpenTerminalCwdData>(
            await this.ctx.http(this.url('/files/cwd'), {
                method: 'GET',
                headers: this.headers()
            })
        )
        const root = current.cwd || '/'
        this._home = root

        const home = await this.execute('printf %s "$HOME"', {
            workdir: root,
            timeout: 5000
        }).catch(() => undefined)
        if (home?.stdout?.startsWith('/')) {
            this._home = home.stdout.trim()
        }

        if (this.options.cwd) {
            try {
                const result = readOpenTerminalData<OpenTerminalListData>(
                    await this.ctx.http(this.url('/files/list'), {
                        method: 'GET',
                        headers: this.headers(),
                        params: {
                            directory: this.options.cwd
                        }
                    })
                )
                this._root = result.dir || this.options.cwd
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
        const target = this.resolvePath(filePath)

        try {
            const result = readOpenTerminalData<
                OpenTerminalListData & {
                    entries?: { name?: string; type?: string }[]
                }
            >(
                await this.ctx.http(this.url('/files/list'), {
                    method: 'GET',
                    headers: this.headers(),
                    params: {
                        directory: target
                    }
                })
            )
            const dir = result.dir || target
            const entries = Array.isArray(result.entries) ? result.entries : []

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

        const params = new URLSearchParams({ path: target })
        if (offset != null) {
            params.set('start_line', String(offset))
        }

        if (limit != null) {
            params.set(
                'end_line',
                String(offset != null ? offset + limit - 1 : limit)
            )
        }

        const result = readOpenTerminalData<{
            content?: string
            total_lines?: number
        }>(
            await this.ctx.http(this.url(`/files/read?${params.toString()}`), {
                method: 'GET',
                headers: this.headers()
            })
        )

        const text =
            typeof result.content === 'string'
                ? result.content
                : typeof result === 'string'
                  ? result
                  : JSON.stringify(result)

        if (offset == null && limit == null) {
            return text
        }

        const start = offset ?? 1
        const lines = text.split('\n')
        const resultLines = lines.map((line, idx) => `${start + idx}: ${line}`)
        const total =
            typeof result.total_lines === 'number'
                ? result.total_lines
                : start + lines.length - 1
        if (start + lines.length - 1 >= total) {
            return resultLines.join('\n')
        }

        return `${resultLines.join('\n')}\n\n(Showing lines ${start}-${start + lines.length - 1} of ${total}. Use offset=${start + lines.length} to continue.)`
    }

    async writeFile(filePath: string, content: FileContent) {
        if (typeof content !== 'string') {
            const target = this.resolvePath(filePath)
            const dir = posix.dirname(target)
            const tmp = `${target}.${randomUUID()}.base64`

            await this.execute(`mkdir -p ${quoteShell(dir)}`)
            await this.writeFile(tmp, Buffer.from(content).toString('base64'))

            try {
                const result = await this.execute(
                    `base64 -d ${quoteShell(tmp)} > ${quoteShell(target)}`
                )
                if (result.exitCode !== 0) {
                    throw new Error(
                        result.stderr ||
                            result.stdout ||
                            `Failed to write ${filePath}`
                    )
                }
            } finally {
                await this.execute(`rm -f ${quoteShell(tmp)}`).catch(() => {})
            }

            return
        }

        await this.ctx.http.post(
            this.url('/files/write'),
            {
                path: this.resolvePath(filePath),
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

        const result = readOpenTerminalData<{
            matches?: { file?: string; line?: number; content?: string }[]
        }>(
            await this.ctx.http(this.url(`/files/grep?${params.toString()}`), {
                method: 'GET',
                headers: this.headers()
            })
        )

        const matches = Array.isArray(result.matches) ? result.matches : []

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
        const result = readOpenTerminalData<{
            matches?: { path?: string }[]
        }>(
            await this.ctx.http(this.url(`/files/glob?${params.toString()}`), {
                method: 'GET',
                headers: this.headers()
            })
        )

        const matches = Array.isArray(result.matches) ? result.matches : []

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
        const cwd = this.resolvePath(options.workdir || this._cwd)
        const term = await openOpenTerminal(this.ctx, {
            url: (pathname) => this.url(pathname),
            headers: this.headers(),
            apiKey: this.resolveSecret(this.cfg.apiKey),
            cwd,
            cols: 120,
            rows: 30
        })
        const id = randomUUID().replaceAll('-', '')
        const start = `__CHATLUNA_OPEN_TERMINAL_START__${id}`
        const end = `__CHATLUNA_OPEN_TERMINAL_END__${id}`
        const stdoutPath = `/tmp/chatluna-${id}.stdout`
        const stderrPath = `/tmp/chatluna-${id}.stderr`
        const env = options.env
            ? Object.entries(options.env)
                  .map(([key, value]) => `export ${key}=${quoteShell(value)}`)
                  .join('\n')
            : ''
        const wrapped = `${env ? `${env}\n` : ''}stty -echo 2>/dev/null
export PS1=''
__chatluna_stdout=${quoteShell(stdoutPath)}
__chatluna_stderr=${quoteShell(stderrPath)}
rm -f "$__chatluna_stdout" "$__chatluna_stderr"
: > "$__chatluna_stdout"
: > "$__chatluna_stderr"
printf '%s\n' ${quoteShell(start)}
__chatluna_shell=$(command -v bash || command -v sh)
"$__chatluna_shell" -lc ${quoteShell(command)} >"$__chatluna_stdout" 2>"$__chatluna_stderr"
__chatluna_code=$?
printf '\n${end}:%s\n' "$__chatluna_code"
exit
`

        let pending = ''
        let started = false
        let exitCode = 1
        let timedOut = false
        const timeout = options.timeout ?? 30000
        let result = { exitCode: 1 }

        try {
            result = await new Promise<{ exitCode: number }>((resolve) => {
                let done = false
                let timer: NodeJS.Timeout | undefined
                let queue = Promise.resolve()

                const finish = (code: number) => {
                    if (done) {
                        return
                    }

                    done = true
                    clearTimeout(timer)
                    resolve({ exitCode: code })
                }

                const trim = () => {
                    if (!started) {
                        const match = pending.match(
                            new RegExp(
                                `(?:^|\\r\\n|\\n|\\r)${escapeRegExp(start)}(?:\\r\\n|\\n|\\r)`
                            )
                        )
                        if (!match || match.index == null) {
                            const size = start.length + 8
                            if (pending.length > size) {
                                pending = pending.slice(-size)
                            }
                            return
                        }

                        pending = pending.slice(match.index + match[0].length)
                        started = true
                    }

                    const match = pending.match(
                        new RegExp(
                            `(?:[\\s\\S]*?)${escapeRegExp(end)}:(-?\\d+)(?:\\r\\n|\\n|\\r)?`
                        )
                    )
                    if (!match) {
                        const size = end.length + 64
                        if (pending.length > size) {
                            pending = pending.slice(-size)
                        }
                        return
                    }

                    exitCode = Number(match[1]) || 0
                    finish(exitCode)
                }

                term.ws.addEventListener('message', (event) => {
                    queue = queue
                        .then(async () => {
                            if (done) {
                                return
                            }

                            pending += await readOpenTerminalMessage(event.data)
                            trim()
                        })
                        .catch(() => undefined)
                })

                term.closed.then(async () => {
                    await queue.catch(() => undefined)
                    if (!done) {
                        finish(exitCode)
                    }
                })

                if (timeout > 0) {
                    timer = setTimeout(() => {
                        trim()
                        if (done) {
                            return
                        }

                        timedOut = true
                        finish(exitCode)
                    }, timeout)
                }

                term.ws.send(Buffer.from(wrapped, 'utf8'))
            })
        } finally {
            await term.kill().catch(() => undefined)
        }

        this._cwd = cwd
        const [stdout, stderr] = await Promise.all([
            this.readFile(stdoutPath).catch(() => ''),
            this.readFile(stderrPath).catch(() => '')
        ])

        return {
            exitCode: result.exitCode,
            stdout,
            stderr,
            timedOut
        }
    }

    async readAsset(filePath: string) {
        const asset = await this.openAsset(filePath)
        return (await readOpenTerminalAsset(asset.stream)).toString('base64')
    }

    async openAsset(filePath: string) {
        const target = this.resolvePath(filePath)
        const url = new URL(this.url('/files/view'))
        url.searchParams.set('path', target)
        const result = await fetch(url, {
            headers: this.headers()
        })

        if (!result.ok || result.body == null) {
            throw new Error(`Failed to open asset: ${result.status}`)
        }

        const mimeType = result.headers.get('content-type')
        const fallback = mimeTypes.lookup(target)
        const size = Number(result.headers.get('content-length') ?? '')
        return {
            stream: Readable.fromWeb(result.body),
            size: Number.isFinite(size) ? size : undefined,
            mimeType: mimeType ?? (fallback === false ? undefined : fallback)
        }
    }

    async createTerminal(options: TerminalOptions = {}) {
        const cwd = this.resolvePath(options.cwd || this._cwd)
        const term = await openOpenTerminal(this.ctx, {
            url: (pathname) => this.url(pathname),
            headers: this.headers(),
            apiKey: this.resolveSecret(this.cfg.apiKey),
            cwd,
            cols: options.cols,
            rows: options.rows
        })
        const callbacks = new Set<(data: string) => void>()
        let closed = false
        let queue = Promise.resolve()
        term.ws.addEventListener('message', (event) => {
            queue = queue
                .then(async () => {
                    const text = await readOpenTerminalMessage(event.data)
                    if (!text) {
                        return
                    }
                    for (const callback of callbacks) {
                        callback(text)
                    }
                })
                .catch(() => undefined)
        })

        term.ws.addEventListener('close', () => {
            closed = true
            callbacks.clear()
        })

        this._cwd = cwd

        return {
            id: term.id,
            async onData(callback) {
                callbacks.add(callback)
                return () => {
                    callbacks.delete(callback)
                }
            },
            async sendInput(data) {
                if (closed || term.ws.readyState !== 1) {
                    return
                }
                term.ws.send(Buffer.from(data, 'utf8'))
            },
            async resize(cols, rows) {
                if (closed || term.ws.readyState !== 1) {
                    return
                }
                term.ws.send(
                    JSON.stringify({
                        type: 'resize',
                        cols,
                        rows
                    })
                )
            },
            async kill() {
                closed = true
                callbacks.clear()
                await term.kill()
            }
        } satisfies TerminalHandle
    }

    async prepareBackgroundCommand(
        command: string,
        marker: string,
        _options: ExecuteOptions = {}
    ) {
        return `${command}
__chatluna_code=$?
printf '\n${marker}:%s\n' "$__chatluna_code"
exit
`
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

    private resolvePath(value: string) {
        if (value === '~') {
            return this._home
        }

        if (value.startsWith('~/')) {
            return `${this._home}/${value.slice(2)}`
        }

        if (value.startsWith('/')) {
            return value
        }

        return `${this._cwd.replace(/[\\/]+$/, '')}/${value}`
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

type OpenTerminalCwdData = {
    cwd?: string
}

type OpenTerminalListData = {
    dir?: string
}

type OpenTerminalEnvelope<T> = {
    data?: T
}

type OpenTerminalTerminalData = {
    id?: string
    created_at?: string
    pid?: number
}

type OpenTerminalSocket = {
    id: string
    ws: ReturnType<Context['http']['ws']>
    closed: Promise<void>
    kill(): Promise<void>
}

async function openOpenTerminal(
    ctx: Context,
    options: {
        url: (pathname: string) => string
        headers: Record<string, string>
        apiKey: string
        cwd: string
        cols?: number
        rows?: number
    }
) {
    const result = readOpenTerminalData<OpenTerminalTerminalData>(
        await ctx.http.post(options.url('/api/terminals'), undefined, {
            headers: options.headers
        })
    )
    if (typeof result.id !== 'string') {
        throw new Error('Failed to create terminal.')
    }

    const ws = ctx.http.ws(
        toWebSocketUrl(options.url(`/api/terminals/${result.id}`)),
        {
            headers: options.headers
        }
    )
    let resolveClosed: (() => void) | undefined
    const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve
    })
    ws.addEventListener('close', () => {
        resolveClosed?.()
    })

    try {
        await new Promise<void>((resolve, reject) => {
            let done = false

            const fail = (message: string) => {
                if (done) {
                    return
                }

                done = true
                reject(new Error(message))
            }

            ws.addEventListener('open', () => {
                if (done) {
                    return
                }

                done = true
                if (options.apiKey) {
                    ws.send(
                        JSON.stringify({
                            type: 'auth',
                            token: options.apiKey
                        })
                    )
                }
                if (options.cols != null && options.rows != null) {
                    ws.send(
                        JSON.stringify({
                            type: 'resize',
                            cols: options.cols,
                            rows: options.rows
                        })
                    )
                }
                ws.send(Buffer.from(`cd ${quoteShell(options.cwd)}\n`, 'utf8'))
                resolve()
            })

            ws.addEventListener('error', () => {
                fail('Failed to open terminal websocket.')
            })

            ws.addEventListener('close', () => {
                fail('Terminal websocket closed before ready.')
            })
        })
    } catch (err) {
        if (ws.readyState === 0 || ws.readyState === 1) {
            ws.close()
        }
        await ctx.http
            .delete(options.url(`/api/terminals/${result.id}`), {
                headers: options.headers
            })
            .catch(() => undefined)
        throw err
    }

    return {
        id: result.id,
        ws,
        closed,
        async kill() {
            if (ws.readyState === 0 || ws.readyState === 1) {
                ws.close()
            }
            await ctx.http
                .delete(options.url(`/api/terminals/${result.id}`), {
                    headers: options.headers
                })
                .catch(() => undefined)
            await closed.catch(() => undefined)
        }
    } satisfies OpenTerminalSocket
}

function ensureTrailingSlash(url: string) {
    return url.endsWith('/') ? url : `${url}/`
}

function toWebSocketUrl(url: string) {
    if (url.startsWith('https://')) {
        return `wss://${url.slice('https://'.length)}`
    }
    if (url.startsWith('http://')) {
        return `ws://${url.slice('http://'.length)}`
    }
    return url
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

function readOpenTerminalData<T>(value: unknown) {
    return ((value as OpenTerminalEnvelope<T>).data ?? value) as T
}

async function readOpenTerminalMessage(value: unknown) {
    if (typeof value === 'string') {
        return value
    }

    if (value instanceof Blob) {
        return Buffer.from(await value.arrayBuffer()).toString('utf8')
    }

    if (Array.isArray(value)) {
        return Buffer.concat(
            value.map((item) =>
                Buffer.isBuffer(item) ? item : Buffer.from(item)
            )
        ).toString('utf8')
    }

    if (ArrayBuffer.isView(value)) {
        return Buffer.from(
            value.buffer,
            value.byteOffset,
            value.byteLength
        ).toString('utf8')
    }

    if (value instanceof ArrayBuffer) {
        return Buffer.from(value).toString('utf8')
    }

    return ''
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
