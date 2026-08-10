/** @module computer/backends/local/index */

import { spawn } from 'child_process'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import mimeTypes from 'mime-types'
import { ComputerCapability, LocalBackendConfig } from '../../../types'
import {
    ComputerSessionApi,
    ExecuteOptions,
    ExecuteResult,
    FileContent,
    TerminalHandle
} from '../../types'
import { buildPosixBackgroundCommand } from '../types'
import { FileStore } from './store'
import { LocalOutputCollector } from './output'
import {
    getPosixShellArgs,
    ResolvedShellCommand,
    resolveInteractiveShellCommand,
    resolveShellCommand
} from './shell'
import { confirmHighRiskCommand, ensureCommandAllowed } from './security'
import {
    ensureLocalCommandAccess,
    ensureLocalPathAccess,
    wrapCommandWithSandbox
} from './sandbox'

export class LocalComputerSession implements ComputerSessionApi {
    readonly backend = 'local' as const
    readonly sessionId: string
    readonly capabilities: ComputerCapability[] = [
        'file_read',
        'file_write',
        'file_edit',
        'file_publish',
        'grep',
        'glob',
        'bash',
        'terminal_pty'
    ]

    private _connected = false
    private _cwd: string
    private _tmp = ''
    private _store: FileStore
    private _children = new Map<ReturnType<typeof spawn>, Promise<void>>()

    constructor(
        private _cfg: LocalBackendConfig,
        id = randomUUID()
    ) {
        this.sessionId = id
        this._cwd = path.resolve(_cfg.scopePath || process.cwd())
    }

    get cwd() {
        return this._cwd
    }

    async connect() {
        this._cwd = await fs.realpath(this._cwd)
        this._tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'chatluna-agent-'))
        await fs.chmod(this._tmp, 0o700)
        this._store = new FileStore(this._cfg, this._tmp)
        this._connected = true
    }

    async disconnect() {
        this._connected = false
        await Promise.allSettled(
            Array.from(this._children, async ([child, settled]) => {
                await killLocalChild(child)
                await settled
            })
        )
        if (this._tmp) {
            await fs.rm(this._tmp, { recursive: true, force: true })
            this._tmp = ''
        }
    }

    isConnected() {
        return this._connected
    }

    async readFile(filePath: string, offset?: number, limit?: number) {
        await ensureLocalPathAccess(filePath, this._cfg, 'read', this._tmp)
        return this._store.readFile(filePath, offset, limit)
    }

    async writeFile(filePath: string, content: FileContent) {
        await ensureLocalPathAccess(filePath, this._cfg, 'write', this._tmp)
        return await this._store.writeFile(filePath, content)
    }

    async editFile(
        filePath: string,
        oldString: string,
        newString: string,
        replaceCount?: number
    ) {
        await ensureLocalPathAccess(filePath, this._cfg, 'write', this._tmp)
        return this._store.editFile(
            filePath,
            oldString,
            newString,
            replaceCount
        )
    }

    async grep(pattern: string, searchPath?: string, include?: string) {
        await ensureLocalPathAccess(
            searchPath || this._store.scope,
            this._cfg,
            'read',
            this._tmp
        )
        return this._store.grep(pattern, searchPath, include)
    }

    async glob(pattern: string, searchPath?: string) {
        await ensureLocalPathAccess(
            searchPath || this._store.scope,
            this._cfg,
            'read',
            this._tmp
        )
        return this._store.glob(pattern, searchPath)
    }

    async execute(command: string, options: ExecuteOptions = {}) {
        if (options.signal?.aborted) {
            throw options.signal.reason ?? new Error('Aborted')
        }

        ensureCommandAllowed(command, this._cfg)

        const tmp = this._tmp
        const workdir = await fs.realpath(
            path.resolve(
                options.workdir || this._cfg.scopePath || process.cwd()
            )
        )

        await ensureLocalCommandAccess(command, workdir, this._cfg)
        await confirmHighRiskCommand(command, this._cfg, options.session)

        await fs.mkdir(this._tmp, { recursive: true })

        const shell = await resolveShellCommand(
            await wrapCommandWithSandbox(command, workdir, this._cfg, tmp),
            this._cfg
        )

        this._cwd = path.resolve(workdir)
        if (!this._connected) {
            throw new Error('Local computer session is disconnected')
        }
        return await runChildProcess(
            shell,
            workdir,
            {
                ...shell.env,
                ...options.env,
                PATH: (options.env?.PATH ?? process.env.PATH)
                    ?.split(path.delimiter)
                    .filter((item) => !item.includes('/xfs-'))
                    .join(path.delimiter),
                TMP: this._tmp,
                TEMP: this._tmp,
                TMPDIR: this._tmp,
                TMPPREFIX: path.join(this._tmp, 'zsh')
            },
            options.timeout ?? this._cfg.commandTimeoutMs,
            this._tmp,
            options.signal,
            this._children
        )
    }

    async prepareBackgroundCommand(
        command: string,
        marker: string,
        options: ExecuteOptions = {}
    ) {
        ensureCommandAllowed(command, this._cfg)

        const tmp = this._tmp
        const workdir = await fs.realpath(
            path.resolve(
                options.workdir || this._cfg.scopePath || process.cwd()
            )
        )

        await ensureLocalCommandAccess(command, workdir, this._cfg)
        await confirmHighRiskCommand(command, this._cfg, options.session)

        await fs.mkdir(tmp, { recursive: true })

        const shell = await resolveInteractiveShellCommand(this._cfg)
        const wrapped = await wrapCommandWithSandbox(
            command,
            workdir,
            this._cfg,
            tmp
        )
        this._cwd = path.resolve(workdir)

        if (process.platform !== 'win32') {
            return buildPosixBackgroundCommand(wrapped, marker)
        }

        if (shell.file.toLowerCase().includes('cmd.exe')) {
            return (
                [
                    wrapped,
                    'set "__chatluna_code=%errorlevel%"',
                    'echo.',
                    `echo ${marker}:%__chatluna_code%`,
                    'exit /b %__chatluna_code%'
                ].join('\r\n') + '\r\n'
            )
        }

        if (shell.file.toLowerCase().includes('bash')) {
            return buildPosixBackgroundCommand(wrapped, marker)
        }

        return (
            [
                wrapped,
                '$__chatluna_code = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }',
                `Write-Output "\`n${marker}:$($__chatluna_code)"`,
                'exit $__chatluna_code'
            ].join('\r\n') + '\r\n'
        )
    }

    async readAsset(filePath: string) {
        await ensureLocalPathAccess(filePath, this._cfg, 'read', this._tmp)
        return (await fs.readFile(filePath)).toString('base64')
    }

    async openAsset(filePath: string) {
        await ensureLocalPathAccess(filePath, this._cfg, 'read', this._tmp)
        const info = await fs.stat(filePath)
        const mimeType = mimeTypes.lookup(filePath)
        return {
            stream: createReadStream(filePath),
            size: info.size,
            mimeType: mimeType === false ? undefined : mimeType
        }
    }

    async getTempDir() {
        return this._tmp
    }

    isInScope(filePath: string) {
        return this._store.isInScope(filePath)
    }

    getScopePath() {
        return this._store.scope
    }

    async createTerminal(
        options: { cwd?: string; cols?: number; rows?: number } = {}
    ) {
        const cwd = await fs.realpath(path.resolve(options.cwd || this._cwd))
        await ensureLocalCommandAccess('', cwd, this._cfg)
        await fs.mkdir(this._tmp, { recursive: true })
        const shell = await resolveInteractiveShellCommand(this._cfg)
        const wrapped =
            process.platform !== 'win32' &&
            !this._cfg.dangerouslySkipPermissions
                ? await wrapCommandWithSandbox(
                      '',
                      cwd,
                      this._cfg,
                      this._tmp,
                      true
                  )
                : undefined
        this._cwd = cwd
        return createLocalTerminal(
            wrapped
                ? {
                      file: shell.file,
                      args: getPosixShellArgs(shell.file, `exec ${wrapped}`),
                      env: shell.env
                  }
                : shell,
            cwd,
            {
                ...shell.env,
                PATH: process.env.PATH?.split(path.delimiter)
                    .filter((item) => !item.includes('/xfs-'))
                    .join(path.delimiter),
                TMP: this._tmp,
                TEMP: this._tmp,
                TMPDIR: this._tmp,
                TMPPREFIX: path.join(this._tmp, 'zsh')
            }
        )
    }
}

async function runChildProcess(
    shell: ResolvedShellCommand,
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeout: number,
    tmp: string,
    signal: AbortSignal | undefined,
    children: Map<ReturnType<typeof spawn>, Promise<void>>
): Promise<ExecuteResult> {
    return await new Promise<ExecuteResult>((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new Error('Aborted'))
            return
        }

        const output = new LocalOutputCollector('bash', tmp)
        const child = spawn(shell.file, shell.args, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            detached: process.platform !== 'win32'
        })
        const closed = new Promise<void>((resolve) => {
            child.once('close', () => resolve())
        })
        let settle!: () => void
        children.set(
            child,
            new Promise((resolve) => {
                settle = resolve
            })
        )

        let done = false
        let timedOut = false
        const timer =
            timeout > 0
                ? setTimeout(() => {
                      timedOut = true
                      killLocalChild(child).catch(() => undefined)
                  }, timeout)
                : undefined
        let hasOutput = false
        let hasStderr = false
        const stdout = { text: '', truncated: false }
        const stderr = { text: '', truncated: false }
        const appendPreview = (
            text: string,
            target: { text: string; truncated: boolean }
        ) => {
            const remaining = 8000 - target.text.length
            if (text.length > remaining) target.truncated = true
            target.text += text.slice(0, remaining)
        }
        const pending = new Set<Promise<void>>()
        const append = (stream: NodeJS.ReadableStream, text: string) => {
            stream.pause()
            const task = output.append(text).finally(() => {
                pending.delete(task)
                stream.resume()
            })
            pending.add(task)
            task.catch((err) => {
                killLocalChild(child).catch(() => undefined)
                fail(err).catch(reject)
            })
        }
        const finish = async (result: ExecuteResult) => {
            if (done) return

            done = true
            if (timer) clearTimeout(timer)
            signal?.removeEventListener('abort', abort)
            try {
                await Promise.all(pending)
                const value = await output.finish()
                const hint = /operation not permitted|permission denied/i.test(
                    value.text
                )
                    ? '\nSandbox note: system temp paths are read-only. ' +
                      'Use $TMPDIR for scratch files; it points to the ' +
                      'session-scoped writable temporary directory.'
                    : ''
                children.delete(child)
                settle()
                resolve({
                    ...result,
                    stdout: stdout.truncated
                        ? `${stdout.text}\n...[output truncated]`
                        : stdout.text,
                    stderr: stderr.truncated
                        ? `${stderr.text}\n...[output truncated]`
                        : stderr.text,
                    output: {
                        ...value,
                        text: value.text
                            ? value.text + hint
                            : hint || '(no output)'
                    }
                })
            } catch (err) {
                try {
                    await output.dispose()
                } finally {
                    children.delete(child)
                    settle()
                }
                reject(err)
            }
        }
        const fail = async (err: unknown) => {
            if (done) return
            done = true
            if (timer) clearTimeout(timer)
            signal?.removeEventListener('abort', abort)
            child.stdout.removeAllListeners('data')
            child.stderr.removeAllListeners('data')
            child.stdout.destroy()
            child.stderr.destroy()
            await closed
            try {
                await output.dispose()
            } finally {
                children.delete(child)
                settle()
            }
            reject(err)
        }
        const abort = () => {
            // eslint-disable-next-line no-void
            void killLocalChild(child).catch(() => undefined)
            fail(signal?.reason ?? new Error('Aborted')).catch(reject)
        }

        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) {
            abort()
            return
        }

        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (text: string) => {
            const value = text.replace(/\r\n/g, '\n')
            appendPreview(value, stdout)
            append(child.stdout, value)
            hasOutput = true
        })

        child.stderr.on('data', (text: string) => {
            const value = text.replace(/\r\n/g, '\n')
            appendPreview(value, stderr)
            append(
                child.stderr,
                `${hasStderr ? '' : `${hasOutput ? '\n' : ''}[stderr]\n`}${value}`
            )
            hasOutput = true
            hasStderr = true
        })

        child.on('error', (err) => {
            fail(err).catch(reject)
        })

        child.on('close', (code, signal) => {
            finish({
                exitCode: timedOut ? 1 : (code ?? 1),
                stdout: stdout.text,
                stderr: stderr.text,
                signal: signal ?? undefined,
                timedOut
            }).catch(reject)
        })
    })
}

function createLocalTerminal(
    shell: ResolvedShellCommand,
    cwd: string,
    env?: NodeJS.ProcessEnv
): TerminalHandle {
    const child = spawn(shell.file, shell.args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
    })
    const callbacks = new Set<(data: string) => void>()
    const send = (chunk: Buffer | string) => {
        const data = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
        for (const callback of callbacks) {
            callback(data)
        }
    }

    child.stdout.on('data', send)
    child.stderr.on('data', send)

    return {
        id: randomUUID(),
        async onData(callback) {
            callbacks.add(callback)
            return () => {
                callbacks.delete(callback)
            }
        },
        async sendInput(data) {
            child.stdin.write(data)
        },
        async resize() {},
        async kill() {
            await killLocalChild(child)
        }
    }
}

async function killLocalChild(child: ReturnType<typeof spawn>) {
    if (!child.pid) {
        child.kill('SIGTERM')
        return
    }

    if (process.platform !== 'win32') {
        try {
            process.kill(-child.pid, 'SIGKILL')
            return
        } catch {}

        child.kill('SIGKILL')
        return
    }

    await new Promise<void>((resolve) => {
        const killer = spawn(
            'taskkill.exe',
            ['/pid', String(child.pid), '/t', '/f'],
            {
                stdio: 'ignore',
                windowsHide: true
            }
        )

        killer.on('error', () => {
            child.kill('SIGTERM')
            resolve()
        })
        killer.on('close', () => resolve())
    })
}
