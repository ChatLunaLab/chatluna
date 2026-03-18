/** @module computer/backends/local/index */

import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import mimeTypes from 'mime-types'
import { ComputerCapability, LocalBackendConfig } from '../../../types'
import {
    ComputerSessionApi,
    ExecuteOptions,
    ExecuteResult,
    TerminalHandle
} from '../../types'
import { truncateOutput } from '../types'
import { FileStore } from './store'
import {
    ResolvedShellCommand,
    resolveInteractiveShellCommand,
    resolveShellCommand
} from './shell'
import {
    confirmHighRiskCommand,
    ensureCommandAllowed,
    ensureCommandPathsInScope,
    ensureWorkdirInScope
} from './security'
import {
    ensureLocalCommandAccess,
    ensureLocalPathAccess,
    wrapCommandWithSandbox
} from './sandbox'

export class LocalComputerSession implements ComputerSessionApi {
    readonly backend = 'local' as const
    readonly sessionId: string
    readonly capabilities = CAPABILITIES

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
        await fs.mkdir(tmpdir(this._cfg), { recursive: true })
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

    async writeFile(filePath: string, content: string) {
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

        const tmp = tmpdir(this._cfg)
        const workdir = options.workdir || this._cfg.scopePath || process.cwd()

        ensureWorkdirInScope(workdir, this._cfg)
        ensureCommandPathsInScope(command, this._cfg, (filePath) =>
            this.isInScope(filePath)
        )
        ensureLocalCommandAccess(command, workdir, this._cfg)
        await confirmHighRiskCommand(command, this._cfg, options.session)

        await fs.mkdir(tmp, { recursive: true })

        const timeout = options.timeout ?? this._cfg.commandTimeoutMs
        const shell = await resolveShellCommand(
            wrapCommandWithSandbox(command, workdir, this._cfg, tmp),
            this._cfg
        )
        const env = { ...shell.env, ...tmpEnv(tmp), ...options.env }

        this._cwd = path.resolve(workdir)
        return await runChildProcess(shell, workdir, env, timeout)
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

    isInScope(filePath: string) {
        return this._store.isInScope(filePath)
    }

    getScopePath() {
        return this._store.scope
    }

    async createTerminal(
        options: { cwd?: string; cols?: number; rows?: number } = {}
    ) {
        const tmp = tmpdir(this._cfg)
        const cwd = options.cwd || this._cwd
        const shell = await resolveInteractiveShellCommand(this._cfg)
        const env = { ...shell.env, ...tmpEnv(tmp) }
        return createLocalTerminal(shell, cwd, env)
    }
}

async function runChildProcess(
    shell: ResolvedShellCommand,
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeout: number
): Promise<ExecuteResult> {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeout)

    try {
        const result = await new Promise<{
            code: number | null
            stdout: string
            stderr: string
            signal: NodeJS.Signals | null
        }>((resolve, reject) => {
            const stdoutChunks: Buffer[] = []
            const stderrChunks: Buffer[] = []
            const child = spawn(shell.file, shell.args, {
                cwd,
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
                signal: ac.signal
            })

            let done = false
            child.stdout.on('data', (chunk: Buffer | string) => {
                stdoutChunks.push(
                    Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                )
            })

            child.stderr.on('data', (chunk: Buffer | string) => {
                stderrChunks.push(
                    Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                )
            })

            child.on('error', (err) => {
                if (done) {
                    return
                }

                done = true
                reject(err)
            })

            child.on('close', (code, signal) => {
                if (done) {
                    return
                }

                done = true
                resolve({
                    code,
                    signal,
                    stdout: decodeOutput(stdoutChunks),
                    stderr: decodeOutput(stderrChunks)
                })
            })
        })

        return {
            exitCode: result.code ?? 0,
            stdout: truncateOutput(result.stdout, 8000),
            stderr: truncateOutput(result.stderr, 2000),
            signal: result.signal ?? undefined,
            timedOut: false
        }
    } catch (err) {
        if (ac.signal.aborted) {
            return {
                exitCode: 1,
                stdout: '',
                stderr: '',
                timedOut: true
            }
        }

        throw err
    } finally {
        clearTimeout(timer)
    }
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
        },
        async sendInput(data) {
            child.stdin.write(data)
        },
        async resize() {},
        async kill() {
            child.kill()
        }
    }
}

function decodeOutput(chunks: Buffer[]): string {
    return Buffer.concat(chunks).toString('utf8').replace(/\r\n/g, '\n')
}

function tmpdir(cfg: LocalBackendConfig) {
    return path.join(cfg.scopePath || process.cwd(), '.tmp')
}

function tmpEnv(tmp: string): NodeJS.ProcessEnv {
    return {
        TMP: tmp,
        TEMP: tmp,
        TMPDIR: tmp
    }
}

const CAPABILITIES: ComputerCapability[] = [
    'file_read',
    'file_write',
    'file_edit',
    'file_publish',
    'grep',
    'glob',
    'bash',
    'terminal_pty'
]
