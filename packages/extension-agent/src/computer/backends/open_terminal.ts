/** @module computer/backends/open_terminal */

import { createHash, randomUUID } from 'crypto'
import { Buffer } from 'node:buffer'
import { posix } from 'path'
import { Readable } from 'node:stream'
import { Context } from 'koishi'
import type {} from '@koishijs/plugin-proxy-agent'
import mimeTypes from 'mime-types'
import { buildHashCommand, quoteShell, readHashCommandOutput } from './types'
import { ComputerCapability, OpenTerminalBackendConfig } from '../../types'
import {
    ComputerSessionApi,
    ExecuteOptions,
    ExecuteResult,
    FileContent,
    ScreenshotResult,
    StreamHandle,
    TerminalHandle,
    TerminalOptions
} from '../types'

export class OpenTerminalComputerSession implements ComputerSessionApi {
    readonly backend = 'open-terminal' as const
    readonly sessionId: string
    readonly capabilities = [
        'file_read',
        'file_write',
        'file_publish',
        'file_edit',
        'grep',
        'glob',
        'bash',
        'terminal_pty'
    ] as ComputerCapability[]

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

        const root =
            readOpenTerminalData<OpenTerminalCwdData>(
                await this.ctx.http(this.url('/files/cwd'), {
                    method: 'GET',
                    proxyAgent: '',
                    headers: this.headers()
                })
            ).cwd || '/'
        this._home = root

        if (this.options.cwd) {
            try {
                const result = readOpenTerminalData<OpenTerminalListData>(
                    await this.ctx.http(this.url('/files/list'), {
                        method: 'GET',
                        proxyAgent: '',
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
                    proxyAgent: '',
                    headers: this.headers(),
                    params: {
                        directory: target
                    }
                })
            )
            const dir = result.dir || target

            return (Array.isArray(result.entries) ? result.entries : [])
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
                proxyAgent: '',
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
        const total =
            typeof result.total_lines === 'number'
                ? result.total_lines
                : start + lines.length - 1
        const numbered = lines.map((line, idx) => `${start + idx}: ${line}`)

        if (start + lines.length - 1 >= total) {
            return numbered.join('\n')
        }

        return `${numbered.join('\n')}\n\n(Showing lines ${start}-${start + lines.length - 1} of ${total}. Use offset=${start + lines.length} to continue.)`
    }

    async writeFile(filePath: string, content: FileContent) {
        if (typeof content !== 'string') {
            const target = this.resolvePath(filePath)
            const form = new FormData()
            form.append(
                'file',
                new Blob([Buffer.from(content)], {
                    type: 'application/octet-stream'
                }),
                posix.basename(target)
            )
            const res = await fetch(
                this.url(
                    `/files/upload?${new URLSearchParams({
                        directory: posix.dirname(target)
                    }).toString()}`
                ),
                {
                    method: 'POST',
                    headers: this.headers(),
                    body: form
                }
            )

            if (!res.ok) {
                throw new Error(await res.text())
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
                proxyAgent: '',
                headers: {
                    ...this.headers(),
                    'content-type': 'application/json'
                }
            }
        )
    }

    async hashFiles(paths: string[]) {
        const hashes = await this.execute(
            buildHashCommand(
                paths.map((file) => [file, this.resolvePath(file)])
            ),
            { timeout: 30000 }
        )
            .then((result) => readHashCommandOutput(result))
            .catch(() => new Map<string, string>())
        const missing = paths.filter((file) => !hashes.has(file))
        await Promise.all(
            missing.map(async (file) => {
                const result = await this.ctx
                    .http(this.url('/files/view'), {
                        method: 'GET',
                        proxyAgent: '',
                        headers: this.headers(),
                        params: { path: this.resolvePath(file) },
                        responseType: 'arraybuffer',
                        validateStatus: () => true
                    })
                    .catch(() => undefined)

                if (!result || result.status < 200 || result.status >= 300) {
                    return
                }

                hashes.set(
                    file,
                    createHash('sha1')
                        .update(Buffer.from(result.data))
                        .digest('hex')
                )
            })
        )
        return hashes
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
            if (content.indexOf(oldString, firstIdx + 1) !== -1) {
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
                proxyAgent: '',
                headers: {
                    ...this.headers(),
                    'content-type': 'application/json'
                }
            }
        )

        const lines = next.split('\n')
        const row = lines.findIndex((line) => line.includes(newString))
        const start = Math.max(0, row - 10)

        return {
            success: true,
            replacements,
            context: lines
                .slice(start, Math.min(lines.length, row + 11))
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
                proxyAgent: '',
                headers: this.headers()
            })
        )

        return (Array.isArray(result.matches) ? result.matches : [])
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
                proxyAgent: '',
                headers: this.headers()
            })
        )

        return (Array.isArray(result.matches) ? result.matches : [])
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
        const timeout = options.timeout ?? 120000
        const result: ExecuteResult = {
            exitCode: 1,
            stdout: '',
            stderr: '',
            timedOut: false
        }
        const start = Date.now()
        let data = await this.postExecute(command, cwd, options, timeout)
        let offset = collectOpenTerminalOutput(data, result)
        let left = timeout <= 0 ? 300000 : timeout - (Date.now() - start)

        while (data.id && data.status === 'running' && left > 0) {
            data = await this.getExecuteStatus(data.id, offset, left)
            offset = collectOpenTerminalOutput(data, result)
            left = timeout <= 0 ? 300000 : timeout - (Date.now() - start)
        }

        if (data.id && data.status === 'running') {
            result.timedOut = true
            await this.ctx.http
                .delete(
                    this.url(
                        `/execute/${encodeURIComponent(data.id)}?force=true`
                    ),
                    {
                        proxyAgent: '',
                        headers: this.headers()
                    }
                )
                .catch(() => undefined)
        }

        result.exitCode = data.exit_code ?? (result.timedOut ? 1 : 0)
        this._cwd = cwd
        return result
    }

    async readAsset(filePath: string) {
        const { stream } = await this.openAsset(filePath)
        const chunks: Buffer[] = []
        for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        return Buffer.concat(chunks).toString('base64')
    }

    async openAsset(filePath: string) {
        const target = this.resolvePath(filePath)
        const result = await this.ctx.http(this.url('/files/view'), {
            method: 'GET',
            proxyAgent: '',
            headers: this.headers(),
            params: { path: target },
            responseType: 'arraybuffer',
            validateStatus: () => true
        })

        if (result.status < 200 || result.status >= 300) {
            throw new Error(`Failed to open asset: ${result.status}`)
        }

        const size = Number(result.headers.get('content-length') ?? '')
        const fallback = mimeTypes.lookup(target)
        return {
            stream: Readable.from(Buffer.from(result.data)),
            size: Number.isFinite(size) ? size : undefined,
            mimeType:
                result.headers.get('content-type') ??
                (fallback === false ? undefined : fallback)
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

    async getTempDir() {
        const result = await this.execute(
            "printf %s '$" + '{TMPDIR:-$' + '{TMP:-$' + "{TEMP:-/tmp}}}'"
        )
        return result.stdout.trim() || '/tmp'
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

    private async postExecute(
        command: string,
        cwd: string,
        options: ExecuteOptions,
        timeout: number
    ) {
        const query = new URLSearchParams({
            wait: String(Math.min(Math.max(timeout, 0), 300000) / 1000)
        })
        return readOpenTerminalData<OpenTerminalExecuteData>(
            await this.ctx.http.post(
                this.url(`/execute?${query.toString()}`),
                {
                    command,
                    cwd,
                    env: options.env
                },
                {
                    proxyAgent: '',
                    headers: {
                        ...this.headers(),
                        'content-type': 'application/json'
                    }
                }
            )
        )
    }

    private async getExecuteStatus(
        id: string,
        offset: number,
        timeout: number
    ) {
        const query = new URLSearchParams({
            wait: String(Math.min(Math.max(timeout, 0), 300000) / 1000),
            offset: String(offset)
        })
        return readOpenTerminalData<OpenTerminalExecuteData>(
            await this.ctx.http(
                this.url(
                    `/execute/${encodeURIComponent(id)}/status?${query.toString()}`
                ),
                {
                    method: 'GET',
                    proxyAgent: '',
                    headers: this.headers()
                }
            )
        )
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
        const key = this.resolveSecret(this.cfg.apiKey)
        if (key) {
            headers.Authorization = `Bearer ${key}`
        }
        if (this.options.userId) {
            headers['X-User-Id'] = this.options.userId
        }

        this._headers = headers
        return headers
    }

    private url(pathname: string) {
        const base = this.cfg.baseUrl
        return new URL(
            pathname,
            base.endsWith('/') ? base : `${base}/`
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

type OpenTerminalExecuteData = {
    id?: string
    status?: string
    exit_code?: number | null
    output?: { type?: string; data?: string }[]
    next_offset?: number
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
            proxyAgent: '',
            headers: options.headers
        })
    )
    if (typeof result.id !== 'string') {
        throw new Error('Failed to create terminal.')
    }

    const ws = ctx.http.ws(
        toWebSocketUrl(options.url(`/api/terminals/${result.id}`)),
        {
            proxyAgent: '',
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
                proxyAgent: '',
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
                    proxyAgent: '',
                    headers: options.headers
                })
                .catch(() => undefined)
            await closed.catch(() => undefined)
        }
    } satisfies OpenTerminalSocket
}

function toWebSocketUrl(url: string) {
    return url.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
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

function collectOpenTerminalOutput(
    data: OpenTerminalExecuteData,
    result: ExecuteResult
) {
    for (const item of data.output ?? []) {
        if (!item.data) {
            continue
        }

        if (item.type === 'stderr') {
            result.stderr += item.data
        } else {
            result.stdout += item.data
        }
    }

    return data.next_offset ?? 0
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
