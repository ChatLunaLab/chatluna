import type { Readable } from 'node:stream'
import { Session } from 'koishi'
import { ComputerBackendType, ComputerCapability } from '../types'

export type FileContent = string | Uint8Array

export interface ComputerSessionApi {
    readonly backend: ComputerBackendType
    readonly sessionId: string
    readonly cwd: string
    readonly capabilities: ComputerCapability[]

    connect(): Promise<void>
    disconnect(): Promise<void>
    isConnected(): boolean

    readFile(path: string, offset?: number, limit?: number): Promise<string>
    writeFile(path: string, content: FileContent): Promise<void>
    hashFiles?(paths: string[]): Promise<Map<string, string>>
    editFile(
        path: string,
        oldString: string,
        newString: string,
        replaceCount?: number
    ): Promise<EditResult>
    grep(
        pattern: string,
        searchPath?: string,
        include?: string
    ): Promise<string[]>
    glob(pattern: string, searchPath?: string): Promise<string[]>
    execute(command: string, options?: ExecuteOptions): Promise<ExecuteResult>
    readAsset?(path: string): Promise<string>
    openAsset(path: string): Promise<OpenAssetResult>
    getTempDir(): Promise<string>

    createTerminal?(options?: TerminalOptions): Promise<TerminalHandle>
    prepareBackgroundCommand?(
        command: string,
        marker: string,
        options?: ExecuteOptions
    ): Promise<string>
    getDesktopInfo?(): Promise<DesktopInfo | undefined>
    screenshot?(): Promise<ScreenshotResult>
    desktopAction?(action: DesktopAction): Promise<void>
    getDesktopStream?(): Promise<StreamHandle | undefined>

    isInScope(path: string): boolean
    getScopePath(): string
}

export interface ExecuteOptions {
    workdir?: string
    timeout?: number
    env?: Record<string, string>
    session?: Session
}

/** @module computer/types */

export interface ExecuteResult {
    exitCode: number
    stdout: string
    stderr: string
    signal?: string
    timedOut: boolean
}

export interface EditResult {
    success: boolean
    context: string
    replacements: number
}

export interface TerminalOptions {
    cols?: number
    rows?: number
    cwd?: string
}

export interface TerminalHandle {
    id: string
    onData(callback: (data: string) => void): Promise<() => void>
    sendInput(data: string): Promise<void>
    resize(cols: number, rows: number): Promise<void>
    kill(): Promise<void>
}

export interface DesktopInfo {
    width: number
    height: number
    streamUrl?: string
}

export type DesktopAction =
    | {
          type: 'click'
          x: number
          y: number
          button?: 'left' | 'right' | 'middle'
      }
    | { type: 'type'; text: string }
    | { type: 'key'; key: string }
    | { type: 'scroll'; x: number; y: number; deltaX?: number; deltaY: number }
    | {
          type: 'drag'
          startX: number
          startY: number
          endX: number
          endY: number
      }

export interface ScreenshotResult {
    data: string
    mimeType: string
    width: number
    height: number
}

export interface StreamHandle {
    url: string
    stop(): Promise<void>
}

export interface OpenAssetResult {
    stream: Readable
    size?: number
    mimeType?: string
}
