/** @module computer/backends/e2b */

import { randomUUID } from 'crypto'
import { Buffer } from 'node:buffer'
import { CommandHandle, CommandResult, Sandbox as E2BSandbox } from 'e2b'
import { Sandbox as DesktopSandbox } from '@e2b/desktop'
import { parsePorts } from '../ports'
import { quoteShell } from './types'
import { E2BBackendConfig } from '../../types'
import {
    ComputerSessionApi,
    DesktopAction,
    DesktopInfo,
    ExecuteOptions,
    ScreenshotResult,
    StreamHandle,
    TerminalHandle,
    TerminalOptions
} from '../types'

interface SandboxWrapper {
    sandboxId: string
    files: E2BSandbox['files']
    commands: E2BSandbox['commands']
    pty: E2BSandbox['pty']
    setTimeout(timeoutMs: number): Promise<void>
    pause(): Promise<void>
    kill(): Promise<void>
    getHost(port: number): string
    desktop?: DesktopSandbox
}

export class E2BComputerSession implements ComputerSessionApi {
    readonly backend = 'e2b' as const
    readonly sessionId: string
    readonly capabilities = [...CAPABILITIES]

    private _connected = false
    private _cwd: string
    private _sandbox?: SandboxWrapper
    private _sandboxId?: string

    constructor(
        private cfg: E2BBackendConfig,
        private options: { cwd?: string },
        id = randomUUID()
    ) {
        this.sessionId = id
        this._cwd = options.cwd || '/workspace'
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

        if (this._sandboxId && this.cfg.keepAlive) {
            this._sandbox = wrapSandbox(
                this.usesDesktop()
                    ? await DesktopSandbox.connect(this._sandboxId, {
                          apiKey,
                          timeoutMs: this.cfg.timeoutMs
                      })
                    : await E2BSandbox.connect(this._sandboxId, {
                          apiKey,
                          timeoutMs: this.cfg.timeoutMs
                      })
            )
        } else {
            this._sandbox = wrapSandbox(
                this.usesDesktop()
                    ? await DesktopSandbox.create(this.cfg.desktopTemplate, {
                          apiKey,
                          timeoutMs: this.cfg.timeoutMs
                      })
                    : await E2BSandbox.create(this.cfg.template, {
                          apiKey,
                          timeoutMs: this.cfg.timeoutMs
                      })
            )
        }

        this._sandboxId = this._sandbox.sandboxId
        await this._sandbox.setTimeout(this.cfg.timeoutMs)
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
            await this._sandbox.pause()
        } else {
            await this._sandbox.kill()
        }

        this._connected = false
    }

    isConnected() {
        return this._connected
    }

    async readFile(filePath: string, offset?: number, limit?: number) {
        const raw = await this.ensureSandbox().files.read(filePath)
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

    async writeFile(filePath: string, content: string) {
        await this.ensureSandbox().files.write(filePath, content)
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
        const result = await this.ensureSandbox().commands.run(command, {
            cwd: options.workdir || this._cwd,
            timeoutMs: options.timeout,
            envs: options.env
        })
        this._cwd = options.workdir || this._cwd
        return mapCommandResult(result)
    }

    async createTerminal(options: TerminalOptions = {}) {
        const sandbox = this.ensureSandbox()
        const callbacks = new Set<(data: string) => void>()
        const handle = await sandbox.pty.create({
            cols: options.cols ?? 80,
            rows: options.rows ?? 24,
            cwd: options.cwd || this._cwd,
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

    async listPorts() {
        const result = await this.execute('ss -ltnp || netstat -ltnp')
        return parsePorts(
            [result.stdout, result.stderr].filter(Boolean).join('\n')
        )
    }

    async getDesktopInfo(): Promise<DesktopInfo | undefined> {
        const desktop = this.ensureDesktopSandbox()
        if (!desktop) {
            return undefined
        }

        await desktop.stream.start().catch(() => undefined)
        const size = await desktop.getScreenSize()
        return {
            width: size.width,
            height: size.height,
            streamUrl: desktop.stream.getUrl({
                autoConnect: true,
                resize: 'scale'
            })
        }
    }

    async screenshot(): Promise<ScreenshotResult> {
        const desktop = this.ensureDesktopSandbox()
        if (!desktop) {
            throw new Error('Desktop is not enabled for this E2B session.')
        }

        const bytes = await desktop.screenshot('bytes')
        const size = await desktop.getScreenSize()
        return {
            data: Buffer.from(bytes).toString('base64'),
            mimeType: 'image/png',
            width: size.width,
            height: size.height
        }
    }

    async desktopAction(action: DesktopAction) {
        const desktop = this.ensureDesktopSandbox()
        if (!desktop) {
            throw new Error('Desktop is not enabled for this E2B session.')
        }

        if (action.type === 'click') {
            if (action.button === 'right') {
                await desktop.rightClick(action.x, action.y)
                return
            }
            if (action.button === 'middle') {
                await desktop.middleClick(action.x, action.y)
                return
            }
            await desktop.leftClick(action.x, action.y)
            return
        }

        if (action.type === 'type') {
            await desktop.write(action.text)
            return
        }

        if (action.type === 'key') {
            await desktop.press(action.key)
            return
        }

        if (action.type === 'scroll') {
            const direction = action.deltaY < 0 ? 'up' : 'down'
            await desktop.scroll(
                direction,
                Math.max(1, Math.abs(action.deltaY))
            )
            return
        }

        await desktop.drag(
            [action.startX, action.startY],
            [action.endX, action.endY]
        )
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
        return this._cwd
    }

    getProxyUrl(port: number) {
        return this.ensureSandbox().getHost(port)
    }

    private ensureSandbox() {
        if (!this._sandbox) {
            throw new Error('E2B sandbox is not connected.')
        }

        return this._sandbox
    }

    private ensureDesktopSandbox() {
        return this._sandbox?.desktop
    }

    private usesDesktop() {
        return this.cfg.desktopTemplate.length > 0
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

function wrapSandbox(sandbox: E2BSandbox | DesktopSandbox): SandboxWrapper {
    return {
        sandboxId: sandbox.sandboxId,
        files: sandbox.files,
        commands: sandbox.commands,
        pty: sandbox.pty,
        setTimeout: (timeoutMs) => sandbox.setTimeout(timeoutMs),
        pause: async () => {
            await sandbox.pause()
        },
        kill: () => sandbox.kill(),
        getHost: (port) => sandbox.getHost(port),
        desktop: sandbox instanceof DesktopSandbox ? sandbox : undefined
    }
}

const CAPABILITIES = [
    'file_read',
    'file_write',
    'file_edit',
    'grep',
    'glob',
    'bash',
    'terminal_pty',
    'desktop_stream',
    'desktop_screenshot',
    'desktop_action'
] as const
