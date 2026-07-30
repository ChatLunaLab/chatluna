/** @module computer/backends/local/index */

import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
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
    private _store: FileStore

    constructor(
        private _cfg: LocalBackendConfig,
        id = randomUUID()
    ) {
        this.sessionId = id
        this._cwd = _cfg.scopePath || process.cwd()
        this._store = new FileStore(_cfg)
    }

    get cwd() {
        return this._cwd
    }

    async connect() {
        await fs.mkdir(os.tmpdir(), { recursive: true })
        this._connected = true
    }

    async disconnect() {
        this._connected = false
    }

    isConnected() {
        return this._connected
    }

    async readFile(filePath: string, offset?: number, limit?: number) {
        ensureLocalPathAccess(filePath, this._cfg, 'read')
        return this._store.readFile(filePath, offset, limit)
    }

    async writeFile(filePath: string, content: FileContent) {
        ensureLocalPathAccess(filePath, this._cfg, 'write')
        await this._store.writeFile(filePath, content)
    }

    async editFile(
        filePath: string,
        oldString: string,
        newString: string,
        replaceCount?: number
    ) {
        ensureLocalPathAccess(filePath, this._cfg, 'write')
        return this._store.editFile(
            filePath,
            oldString,
            newString,
            replaceCount
        )
    }

    async grep(pattern: string, searchPath?: string, include?: string) {
        if (searchPath) {
            ensureLocalPathAccess(searchPath, this._cfg, 'read')
        }
        return this._store.grep(pattern, searchPath, include)
    }

    async glob(pattern: string, searchPath?: string) {
        if (searchPath) {
            ensureLocalPathAccess(searchPath, this._cfg, 'read')
        }
        return this._store.glob(pattern, searchPath)
    }

    async execute(command: string, options: ExecuteOptions = {}) {
        ensureCommandAllowed(command, this._cfg)

        const tmp = os.tmpdir()
        const workdir = options.workdir || this._cfg.scopePath || process.cwd()

        ensureLocalCommandAccess(command, workdir, this._cfg)
        await confirmHighRiskCommand(command, this._cfg, options.session)

        await fs.mkdir(tmp, { recursive: true })

        const shell = await resolveShellCommand(
            wrapCommandWithSandbox(command, workdir, this._cfg, tmp),
            this._cfg
        )

        this._cwd = path.resolve(workdir)
        return await runChildProcess(
            shell,
            workdir,
            { ...shell.env, TMP: tmp, TEMP: tmp, TMPDIR: tmp, ...options.env },
            options.timeout ?? this._cfg.commandTimeoutMs
        )
    }

    async prepareBackgroundCommand(
        command: string,
        marker: string,
        options: ExecuteOptions = {}
    ) {
        ensureCommandAllowed(command, this._cfg)

        const tmp = os.tmpdir()
        const workdir = options.workdir || this._cfg.scopePath || process.cwd()

        ensureLocalCommandAccess(command, workdir, this._cfg)
        await confirmHighRiskCommand(command, this._cfg, options.session)

        await fs.mkdir(tmp, { recursive: true })

        const shell = await resolveInteractiveShellCommand(this._cfg)
        const wrapped = wrapCommandWithSandbox(command, workdir, this._cfg, tmp)
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
        ensureLocalPathAccess(filePath, this._cfg, 'read')
        return (await fs.readFile(filePath)).toString('base64')
    }

    async openAsset(filePath: string) {
        ensureLocalPathAccess(filePath, this._cfg, 'read')
        const info = await fs.stat(filePath)
        const mimeType = mimeTypes.lookup(filePath)
        return {
            stream: createReadStream(filePath),
            size: info.size,
            mimeType: mimeType === false ? undefined : mimeType
        }
    }

    async getTempDir() {
        return os.tmpdir()
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
        const tmp = os.tmpdir()
        const cwd = options.cwd || this._cwd
        const shell = await resolveInteractiveShellCommand(this._cfg)
        this._cwd = path.resolve(cwd)
        return createLocalTerminal(shell, cwd, {
            ...shell.env,
            TMP: tmp,
            TEMP: tmp,
            TMPDIR: tmp
        })
    }
}

async function runChildProcess(
    shell: ResolvedShellCommand,
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeout: number
): Promise<ExecuteResult> {
    return await new Promise<ExecuteResult>((resolve, reject) => {
        const output = new LocalOutputCollector('bash')
        const child = spawn(shell.file, shell.args, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            detached: process.platform !== 'win32'
        })

        let done = false
        let timedOut = false
        let hasOutput = false
        let hasStderr = false
        let stdout = ''
        let stderr = ''
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
            clearTimeout(timer)
            try {
                await Promise.all(pending)
                const value = await output.finish()
                resolve({
                    ...result,
                    stdout,
                    stderr,
                    output: {
                        ...value,
                        text: value.text || '(no output)'
                    }
                })
            } catch (err) {
                await output.dispose()
                reject(err)
            }
        }
        const fail = async (err: unknown) => {
            if (done) return
            done = true
            clearTimeout(timer)
            await output.dispose()
            reject(err)
        }
        const timer =
            timeout > 0
                ? setTimeout(() => {
                      timedOut = true
                      killLocalChild(child).catch(() => undefined)
                  }, timeout)
                : undefined

        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (text: string) => {
            const value = text.replace(/\r\n/g, '\n')
            stdout += value.slice(0, 8000 - stdout.length)
            append(child.stdout, value)
            hasOutput = true
        })

        child.stderr.on('data', (text: string) => {
            const value = text.replace(/\r\n/g, '\n')
            stderr += value.slice(0, 8000 - stderr.length)
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
                exitCode: timedOut ? 1 : (code ?? 0),
                stdout,
                stderr,
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
