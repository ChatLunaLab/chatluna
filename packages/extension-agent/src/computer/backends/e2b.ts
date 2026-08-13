/** @module computer/backends/e2b */

import { createHash, randomUUID } from 'crypto'
import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import {
    CommandExitError,
    CommandHandle,
    CommandResult,
    CommandStartOpts,
    Sandbox as E2BSandbox,
    NotFoundError,
    TimeoutError
} from 'e2b'
import mimeTypes from 'mime-types'
import { Context } from 'koishi'
import { logger } from '../..'
import {
    buildHashCommand,
    buildPosixBackgroundCommand,
    quoteShell,
    readHashCommandOutput
} from './types'
import { ComputerCapability, E2BBackendConfig } from '../../types'
import { getErrorMessage } from '../../utils/shell'
import {
    ComputerSessionApi,
    DesktopAction,
    DesktopInfo,
    ExecuteOptions,
    ExecuteResult,
    FileContent,
    ScreenshotResult,
    StreamHandle,
    TerminalHandle,
    TerminalOptions
} from '../types'
import { replaceFileContent } from '../file_changes'

interface SandboxWrapper {
    sandboxId: string
    internal: E2BSandbox
    files: E2BSandbox['files']
    commands: E2BSandbox['commands']
    pty: E2BSandbox['pty']
    setTimeout(timeoutMs: number): Promise<void>
    pause(apiKey?: string): Promise<void>
    kill(): Promise<void>
}

export class E2BComputerSession implements ComputerSessionApi {
    readonly backend = 'e2b' as const
    readonly sessionId: string
    readonly capabilities: ComputerCapability[] = [
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
    ]

    private _connected = false
    private _connecting?: Promise<void>
    private _home = '/'
    private _root: string
    private _cwd: string
    private _sandbox?: SandboxWrapper
    private _sandboxId?: string

    constructor(
        private ctx: Context,
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
        if (this._connecting) {
            await this._connecting
            return
        }

        const task = (async () => {
            if (!this.cfg.enabled) {
                throw new Error('E2B backend is disabled.')
            }

            const apiKey = this.resolveSecret(this.cfg.apiKey)
            if (!apiKey) {
                throw new Error('E2B apiKey is empty.')
            }

            let sandbox: SandboxWrapper | undefined
            let created = false

            try {
                if (this._sandboxId && this.cfg.keepAlive) {
                    try {
                        sandbox = wrapSandbox(
                            await E2BSandbox.connect(this._sandboxId, {
                                apiKey,
                                timeoutMs: this.cfg.timeoutMs
                            })
                        )
                    } catch (err) {
                        if (!isMissingSandboxError(err)) {
                            throw err
                        }

                        sandbox = wrapSandbox(
                            await E2BSandbox.create(this.cfg.template, {
                                apiKey,
                                timeoutMs: this.cfg.timeoutMs
                            })
                        )
                        created = true
                    }
                } else {
                    sandbox = wrapSandbox(
                        await E2BSandbox.create(this.cfg.template, {
                            apiKey,
                            timeoutMs: this.cfg.timeoutMs
                        })
                    )
                    created = true
                }

                await sandbox.setTimeout(this.cfg.timeoutMs)
                this._home =
                    (
                        await this.run(
                            'pwd',
                            { timeoutMs: 5000 } as CommandStartOpts,
                            sandbox
                        )
                    ).stdout.trim() || '/'

                if (this.options.cwd) {
                    const cwd = this.resolvePath(this.options.cwd)
                    const stat = await this.run(
                        `if [ -d ${quoteShell(cwd)} ]; then printf __dir__; fi`,
                        { timeoutMs: 5000 } as CommandStartOpts,
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

                this._sandbox = sandbox
                this._sandboxId = sandbox.sandboxId
                this._connected = true
            } catch (err) {
                this._sandbox = undefined
                this._connected = false
                if (created && sandbox) {
                    await sandbox.kill().catch(() => undefined)
                }
                throw err
            }
        })()

        this._connecting = task
        try {
            await task
        } finally {
            if (this._connecting === task) {
                this._connecting = undefined
            }
        }
    }

    async disconnect() {
        await this._connecting?.catch(() => undefined)

        if (!this._sandbox) {
            this._connected = false
            return
        }

        try {
            if (this.cfg.keepAlive) {
                await this._sandbox.pause(this.resolveSecret(this.cfg.apiKey))
            } else {
                await this._sandbox.kill()
                this._sandboxId = undefined
            }
        } catch (err) {
            if (!isMissingSandboxError(err)) {
                throw err
            }

            this._sandboxId = undefined
        } finally {
            this._sandbox = undefined
            this._connected = false
        }
    }

    isConnected() {
        return this._connected
    }

    async readFile(filePath: string, offset?: number, limit?: number) {
        try {
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

            const text = String(
                await (await this.ensureSandbox()).files.read(target)
            )
            if (offset == null && limit == null) {
                return text
            }

            const lines = text.split('\n')
            const start = offset != null ? Math.max(0, offset - 1) : 0
            const end = limit != null ? start + limit : lines.length
            return lines
                .slice(start, end)
                .map((line, idx) => `${start + idx + 1}: ${line}`)
                .join('\n')
        } catch (err) {
            logger.error(err)
            throw new Error(
                `Failed to read ${filePath}: ${getErrorMessage(err)}`
            )
        }
    }

    async writeFile(filePath: string, content: FileContent) {
        try {
            const target = this.resolvePath(filePath)
            const sandbox = await this.ensureSandbox()
            if (typeof content === 'string') {
                const before = (await sandbox.files.exists(target))
                    ? await sandbox.files.read(target)
                    : ''
                await sandbox.files.write(target, content)
                return { type: 'text' as const, before, after: content }
            }

            const data = new ArrayBuffer(content.byteLength)
            new Uint8Array(data).set(content)
            await sandbox.files.write(target, data)
            return { type: 'binary' as const }
        } catch (err) {
            logger.error(err)
            throw new Error(
                `Failed to write ${filePath}: ${getErrorMessage(err)}`
            )
        }
    }

    async hashFiles(paths: string[]) {
        const sandbox = await this.ensureSandbox()
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
                const data = await sandbox.files
                    .read(this.resolvePath(file), { format: 'bytes' })
                    .catch(() => undefined)

                if (!data) {
                    return
                }

                hashes.set(
                    file,
                    createHash('sha1').update(Buffer.from(data)).digest('hex')
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
        const result = replaceFileContent(
            await this.readFile(filePath),
            oldString,
            newString,
            replaceCount
        )
        if (!result.success) return result
        if (result.before === result.after) return result

        await this.writeFile(filePath, result.after)
        return result
    }

    async grep(pattern: string, searchPath?: string, include?: string) {
        try {
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
        } catch (err) {
            logger.error(err)
            throw new Error(`Failed to grep: ${getErrorMessage(err)}`)
        }
    }

    async glob(pattern: string, searchPath?: string) {
        try {
            const dir = searchPath ? this.resolvePath(searchPath) : this._root
            const result = await this.execute(
                `find ${quoteShell(dir)} -type f | grep -E ${quoteShell(pattern)}`
            )
            return [result.stdout, result.stderr]
                .filter(Boolean)
                .join('\n')
                .split('\n')
                .filter(Boolean)
        } catch (err) {
            logger.error(err)
            throw new Error(`Failed to glob: ${getErrorMessage(err)}`)
        }
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
        return result
    }

    async readAsset(filePath: string) {
        try {
            const result = await this.execute(
                `base64 ${quoteShell(this.resolvePath(filePath))} | tr -d '\n'`
            )
            return result.stdout.trim()
        } catch (err) {
            logger.error(err)
            throw new Error(
                `Failed to read asset ${filePath}: ${getErrorMessage(err)}`
            )
        }
    }

    async openAsset(filePath: string) {
        try {
            const sandbox = await this.ensureSandbox()
            const target = this.resolvePath(filePath)
            const info = await sandbox.files.getInfo(target)
            const mime = mimeTypes.lookup(filePath)
            return {
                stream: Readable.fromWeb(
                    (await sandbox.files.read(target, {
                        format: 'stream'
                    })) as unknown as globalThis.ReadableStream<Uint8Array>
                ),
                size: info.size,
                mimeType: mime === false ? undefined : mime
            }
        } catch (err) {
            logger.error(err)
            throw new Error(
                `Failed to open asset ${filePath}: ${getErrorMessage(err)}`
            )
        }
    }

    async getTempDir() {
        const result = await this.execute(
            "printf %s '$" + '{TMPDIR:-$' + '{TMP:-$' + "{TEMP:-/tmp}}}'"
        )
        return result.stdout.trim() || '/tmp'
    }

    async createTerminal(options: TerminalOptions = {}) {
        try {
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
                    for (const cb of callbacks) {
                        cb(text)
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
                    try {
                        await sandbox.pty.sendInput(
                            handle.pid,
                            Buffer.from(data, 'utf8')
                        )
                    } catch (err) {
                        logger.error(err)
                        throw new Error(
                            `Failed to send terminal input: ${getErrorMessage(err)}`
                        )
                    }
                },
                async resize(cols, rows) {
                    try {
                        await sandbox.pty.resize(handle.pid, { cols, rows })
                    } catch (err) {
                        logger.error(err)
                        throw new Error(
                            `Failed to resize terminal: ${getErrorMessage(err)}`
                        )
                    }
                },
                async kill() {
                    try {
                        await handle.kill()
                    } catch (err) {
                        logger.error(err)
                        throw new Error(
                            `Failed to kill terminal: ${getErrorMessage(err)}`
                        )
                    }
                }
            } satisfies TerminalHandle
        } catch (err) {
            logger.error(err)
            throw new Error(
                `Failed to create terminal: ${getErrorMessage(err)}`
            )
        }
    }

    async prepareBackgroundCommand(
        command: string,
        marker: string,
        _options: ExecuteOptions = {}
    ) {
        return buildPosixBackgroundCommand(command, marker)
    }

    async getDesktopInfo(): Promise<DesktopInfo | undefined> {
        return undefined
    }

    async screenshot(): Promise<ScreenshotResult> {
        throw new Error('Desktop is not enabled for this E2B session.')
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async desktopAction(action: DesktopAction) {
        throw new Error('Desktop is not enabled for this E2B session.')
    }

    async getDesktopStream(): Promise<StreamHandle | undefined> {
        return undefined
    }

    async isInScope() {
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
        } catch (err) {
            logger.error(err)
        }

        this._connected = false
        await this.connect()

        return this._sandbox
    }

    private async run(
        command: string,
        options?: CommandStartOpts,
        sandbox?: SandboxWrapper
    ): Promise<ExecuteResult> {
        const current = sandbox ?? (await this.ensureSandbox())
        let handle: CommandHandle | undefined
        let result: CommandResult | undefined
        let runErr: unknown
        let timedOut = false

        try {
            handle = (await current.commands.run(command, {
                ...options,
                background: true
            })) as CommandHandle
            result = await handle.wait()
        } catch (err) {
            if (err instanceof CommandExitError) {
                result = err
            } else if (
                err instanceof TimeoutError ||
                (err instanceof Error && err.name === 'TimeoutError')
            ) {
                timedOut = true
                result = {
                    exitCode: handle?.exitCode ?? 1,
                    stdout: handle?.stdout ?? '',
                    stderr: handle?.stderr ?? ''
                }
            } else {
                runErr = err
            }
        }

        try {
            await current.setTimeout(this.cfg.timeoutMs)
        } catch (err) {
            if (!runErr && !isMissingSandboxError(err)) {
                throw err
            }
        }

        if (runErr) {
            throw runErr
        }

        if (!result) {
            throw new Error('Command finished without a result.')
        }

        return {
            exitCode: result.exitCode ?? 0,
            stdout: result.stdout,
            stderr: result.stderr,
            signal: undefined,
            timedOut
        }
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

function isMissingSandboxError(err: unknown) {
    if (err instanceof NotFoundError) {
        return true
    }

    if (!(err instanceof Error)) {
        return false
    }

    return err.name === 'NotFoundError'
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
    }
}
