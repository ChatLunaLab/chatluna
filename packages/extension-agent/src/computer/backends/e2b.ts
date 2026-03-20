/** @module computer/backends/e2b */

import { randomUUID } from 'crypto'
import { Buffer } from 'node:buffer'
import { posix } from 'path'
import { Readable } from 'node:stream'
import {
    CommandHandle,
    CommandResult,
    CommandStartOpts,
    Sandbox as E2BSandbox
} from 'e2b'
import mimeTypes from 'mime-types'
import { buildPosixBackgroundCommand, quoteShell } from './types'
import { E2BBackendConfig } from '../../types'
import {
    ComputerSessionApi,
    DesktopAction,
    DesktopInfo,
    ExecuteOptions,
    FileContent,
    ScreenshotResult,
    StreamHandle,
    TerminalHandle,
    TerminalOptions
} from '../types'

interface SandboxWrapper {
    sandboxId: string
    internal: E2BSandbox
    files: E2BSandbox['files']
    commands: E2BSandbox['commands']
    pty: E2BSandbox['pty']
    setTimeout(timeoutMs: number): Promise<void>
    pause(apiKey?: string): Promise<void>
    kill(): Promise<void>
    desktop?: never
}

export class E2BComputerSession implements ComputerSessionApi {
    readonly backend = 'e2b' as const
    readonly sessionId: string
    readonly capabilities = [...CAPABILITIES]

    private _connected = false
    private _home = '/'
    private _root: string
    private _cwd: string
    private _sandbox?: SandboxWrapper
    private _sandboxId?: string

    constructor(
        private cfg: E2BBackendConfig,
        private options: { cwd?: string },
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
        if (!this.cfg.enabled) {
            throw new Error('E2B backend is disabled.')
        }

        const apiKey = this.resolveSecret(this.cfg.apiKey)
        if (!apiKey) {
            throw new Error('E2B apiKey is empty.')
        }

        let sandbox: SandboxWrapper

        if (this._sandboxId && this.cfg.keepAlive) {
            try {
                sandbox = wrapSandbox(
                    await E2BSandbox.connect(this._sandboxId, {
                        apiKey,
                        timeoutMs: this.cfg.timeoutMs
                    })
                )
            } catch {
                sandbox = wrapSandbox(
                    await E2BSandbox.create(this.cfg.template, {
                        apiKey,
                        timeoutMs: this.cfg.timeoutMs
                    })
                )
            }
        } else {
            sandbox = wrapSandbox(
                await E2BSandbox.create(this.cfg.template, {
                    apiKey,
                    timeoutMs: this.cfg.timeoutMs
                })
            )
        }

        this._sandbox = sandbox
        this._sandboxId = sandbox.sandboxId
        await sandbox.setTimeout(this.cfg.timeoutMs)
        const current = await this.run(
            'pwd',
            {
                timeoutMs: 5000
            } as CommandStartOpts,
            sandbox
        )
        this._home = current.stdout.trim() || '/'

        if (this.options.cwd) {
            const cwd = this.resolvePath(this.options.cwd)
            const stat = await this.run(
                `if [ -d ${quoteShell(cwd)} ]; then printf __dir__; fi`,
                {
                    timeoutMs: 5000
                } as CommandStartOpts,
                sandbox
            )
            if (stat.stdout.trim() === '__dir__') {
                this._root = cwd
                this._cwd = cwd
            } else {
                this._root = this._home
                this._cwd = this._root
            }
        } else {
            this._root = this._home
            this._cwd = this._root
        }

        this._connected = true
    }

    async disconnect() {
        if (!this._sandbox) {
            this._connected = false
            return
        }

        const desktop = this.ensureDesktopSandbox()
        if (desktop) {
            await desktop.stream.stop().catch(() => undefined)
        }

        if (this.cfg.keepAlive) {
            await this._sandbox.pause(this.resolveSecret(this.cfg.apiKey))
        } else {
            await this._sandbox.kill()
        }

        this._connected = false
    }

    isConnected() {
        return this._connected
    }

    async readFile(filePath: string, offset?: number, limit?: number) {
        const target = this.resolvePath(filePath)
        const stat = await this.execute(
            `if [ -d ${quoteShell(target)} ]; then printf __dir__; fi`,
            { timeout: 5000 }
        )
        if (stat.stdout.trim() === '__dir__') {
            const result = await this.execute(
                `find ${quoteShell(target)} -mindepth 1 -maxdepth 1 \\( -type d -printf '%p/\\n' -o -type f -printf '%p\\n' \\) | sort`
            )
            return result.stdout.trim()
        }

        const raw = await (await this.ensureSandbox()).files.read(target)
        const text = String(raw)
        if (offset == null && limit == null) {
            return text
        }

        const lines = text.split('\n')
        const start = offset != null ? Math.max(0, offset - 1) : 0
        const end =
            limit != null ? Math.min(lines.length, start + limit) : lines.length
        return lines
            .slice(start, end)
            .map((line, idx) => `${start + idx + 1}: ${line}`)
            .join('\n')
    }

    async writeFile(filePath: string, content: FileContent) {
        const target = this.resolvePath(filePath)
        if (typeof content === 'string') {
            await (await this.ensureSandbox()).files.write(target, content)
            return
        }

        const dir = posix.dirname(target)
        const tmp = `${target}.${randomUUID()}.base64`

        await this.execute(`mkdir -p ${quoteShell(dir)}`)
        await this.writeFile(tmp, Buffer.from(content).toString('base64'))

        try {
            const result = await this.execute(
                `base64 -d ${quoteShell(tmp)} > ${quoteShell(target)}`
            )
            if (result.exitCode !== 0) {
                throw new Error(result.stderr || `Failed to write ${filePath}`)
            }
        } finally {
            await this.execute(`rm -f ${quoteShell(tmp)}`).catch(() => {})
        }
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
        const dir = searchPath ? this.resolvePath(searchPath) : this._root
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
        const dir = searchPath ? this.resolvePath(searchPath) : this._root
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
        const cwd = options.workdir
            ? this.resolvePath(options.workdir)
            : this._cwd
        const result = await this.run(command, {
            cwd,
            timeoutMs: options.timeout,
            envs: options.env
        } as CommandStartOpts)
        this._cwd = cwd
        return mapCommandResult(result)
    }

    async readAsset(filePath: string) {
        const result = await this.execute(
            `base64 ${quoteShell(this.resolvePath(filePath))} | tr -d '\n'`
        )
        return result.stdout.trim()
    }

    async openAsset(filePath: string) {
        const sandbox = await this.ensureSandbox()
        const target = this.resolvePath(filePath)
        const info = await sandbox.files.getInfo(target)
        const stream = await sandbox.files.read(target, {
            format: 'stream'
        })
        const mimeType = mimeTypes.lookup(filePath)
        return {
            stream: Readable.fromWeb(
                stream as unknown as globalThis.ReadableStream<Uint8Array>
            ),
            size: info.size,
            mimeType: mimeType === false ? undefined : mimeType
        }
    }

    async createTerminal(options: TerminalOptions = {}) {
        const sandbox = await this.ensureSandbox()
        const callbacks = new Set<(data: string) => void>()
        const cwd = options.cwd ? this.resolvePath(options.cwd) : this._cwd
        const handle = await sandbox.pty.create({
            cols: options.cols ?? 80,
            rows: options.rows ?? 24,
            cwd,
            timeoutMs: this.cfg.timeoutMs,
            onData: (data) => {
                const text = Buffer.from(data).toString('utf8')
                for (const callback of callbacks) {
                    callback(text)
                }
            }
        })

        return {
            id: String(handle.pid),
            async onData(callback) {
                callbacks.add(callback)
                return () => {
                    callbacks.delete(callback)
                }
            },
            async sendInput(data) {
                await sandbox.pty.sendInput(
                    handle.pid,
                    Buffer.from(data, 'utf8')
                )
            },
            async resize(cols, rows) {
                await sandbox.pty.resize(handle.pid, { cols, rows })
            },
            async kill() {
                await handle.kill()
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

    async getDesktopInfo(): Promise<DesktopInfo | undefined> {
        // const desktop = this.ensureDesktopSandbox()
        // if (!desktop) {
        //     return undefined
        // }

        // await desktop.stream.start().catch(() => undefined)
        // const size = await desktop.getScreenSize()
        // return {
        //     width: size.width,
        //     height: size.height,
        //     streamUrl: desktop.stream.getUrl({
        //         autoConnect: true,
        //         resize: 'scale'
        //     })
        // }
        return null
    }

    async screenshot(): Promise<ScreenshotResult> {
        // const desktop = this.ensureDesktopSandbox()
        // if (!desktop) {
        throw new Error('Desktop is not enabled for this E2B session.')
        // }

        // const bytes = await desktop.screenshot('bytes')
        // const size = await desktop.getScreenSize()
        // return {
        //     data: Buffer.from(bytes).toString('base64'),
        //     mimeType: 'image/png',
        //     width: size.width,
        //     height: size.height
        // }
        //
    }

    async desktopAction(action: DesktopAction) {
        const desktop = this.ensureDesktopSandbox()
        if (!desktop) {
            throw new Error('Desktop is not enabled for this E2B session.')
        }

        // if (action.type === 'click') {
        //     if (action.button === 'right') {
        //         await desktop.rightClick(action.x, action.y)
        //         return
        //     }
        //     if (action.button === 'middle') {
        //         await desktop.middleClick(action.x, action.y)
        //         return
        //     }
        //     await desktop.leftClick(action.x, action.y)
        //     return
        // }

        // if (action.type === 'type') {
        //     await desktop.write(action.text)
        //     return
        // }

        // if (action.type === 'key') {
        //     await desktop.press(action.key)
        //     return
        // }

        // if (action.type === 'scroll') {
        //     const direction = action.deltaY < 0 ? 'up' : 'down'
        //     await desktop.scroll(
        //         direction,
        //         Math.max(1, Math.abs(action.deltaY))
        //     )
        //     return
        // }

        // await desktop.drag(
        //     [action.startX, action.startY],
        //     [action.endX, action.endY]
        // )
    }

    async getDesktopStream(): Promise<StreamHandle | undefined> {
        const desktop = this.ensureDesktopSandbox()
        if (!desktop) {
            return undefined
        }

        await desktop.stream.start()
        return {
            url: desktop.stream.getUrl({ autoConnect: true, resize: 'scale' }),
            async stop() {
                await desktop.stream.stop()
            }
        }
    }

    isInScope() {
        return true
    }

    getScopePath() {
        return this._root
    }

    private async ensureSandbox() {
        if (!this._sandbox) {
            await this.connect()
            return this._sandbox
        }

        try {
            if (await this._sandbox.internal.isRunning()) {
                return this._sandbox
            }
        } catch {}

        this._connected = false
        await this.connect()

        return this._sandbox
    }

    private async run(
        command: string,
        options?: CommandStartOpts,
        sandbox?: SandboxWrapper
    ) {
        const current = sandbox ?? (await this.ensureSandbox())

        try {
            return await current.commands.run(command, options)
        } finally {
            await current.setTimeout(SANDBOX_COMMAND_TIMEOUT).catch(() => {})
        }
    }

    private ensureDesktopSandbox() {
        return undefined
    }

    private usesDesktop() {
        return this.cfg.desktopTemplate.length > 0
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

    private resolveSecret(value: string) {
        if (!value.startsWith('env:')) {
            return value
        }

        return process.env[value.slice(4)] ?? ''
    }
}

function mapCommandResult(result: CommandResult | CommandHandle) {
    return {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout,
        stderr: result.stderr,
        signal: undefined,
        timedOut: false
    }
}

function wrapSandbox(sandbox: E2BSandbox): SandboxWrapper {
    return {
        sandboxId: sandbox.sandboxId,
        files: sandbox.files,
        commands: sandbox.commands,
        pty: sandbox.pty,
        setTimeout: (timeoutMs) => sandbox.setTimeout(timeoutMs),
        pause: async (apiKey) => {
            await sandbox.betaPause(apiKey ? { apiKey } : undefined)
        },
        kill: () => sandbox.kill(),
        internal: sandbox
        // desktop: sandbox instanceof DesktopSandbox ? sandbox : undefined
    }
}

const CAPABILITIES = [
    'file_read',
    'file_write',
    'file_edit',
    'file_publish',
    'grep',
    'glob',
    'bash',
    'terminal_pty',
    'desktop_stream',
    'desktop_screenshot',
    'desktop_action'
] as const

const SANDBOX_COMMAND_TIMEOUT = 30_000
