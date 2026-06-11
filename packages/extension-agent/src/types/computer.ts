/** @module types/computer */

export type ComputerBackendType = 'local' | 'e2b' | 'open-terminal'

export interface ComputerConfig {
    defaultProvider: ComputerBackendType
    idleTimeoutMs: number
    local: LocalBackendConfig
    e2b: E2BBackendConfig
    openTerminal: OpenTerminalBackendConfig
}

export interface LocalBackendConfig {
    enabled: boolean
    sandboxMode: 'read-only' | 'workspace-write'
    approvalMode: 'on-request' | 'never'
    dangerouslySkipPermissions: boolean
    preferredShell: 'git-bash' | 'powershell' | 'cmd' | 'auto'
    scopePath: string
    readOnlyRoots: string[]
    denyRoots: string[]
    ignores: string[]
    allowedCommands: string[]
    blockedCommands: string[]
    commandTimeoutMs: number
    networkPolicy: 'block' | 'allow'
}

export interface E2BBackendConfig {
    enabled: boolean
    apiKey: string
    template: string
    desktopTemplate: string
    timeoutMs: number
    keepAlive: boolean
}

export interface OpenTerminalBackendConfig {
    enabled: boolean
    baseUrl: string
    apiKey: string
    deploymentMode: 'docker' | 'bare-metal' | 'unknown'
    userIsolation: boolean
}

export type ComputerBackendState =
    | 'idle'
    | 'connecting'
    | 'connected'
    | 'error'
    | 'unsupported'

export type ComputerCapability =
    | 'file_read'
    | 'file_write'
    | 'file_edit'
    | 'file_publish'
    | 'grep'
    | 'glob'
    | 'bash'
    | 'terminal_pty'
    | 'desktop_stream'
    | 'desktop_screenshot'
    | 'desktop_action'

export interface ComputerBackendStatus {
    type: ComputerBackendType
    state: ComputerBackendState
    error?: string
    capabilities: ComputerCapability[]
    sessionCount: number
}

export interface ComputerStatus {
    enabled: boolean
    defaultProvider: ComputerBackendType
    backends: Record<ComputerBackendType, ComputerBackendStatus>
    activeSessions: number
}

export interface ComputerSessionInfo {
    id: string
    backend: ComputerBackendType
    userId?: string
    conversationId?: string
    createdAt: number
    lastActiveAt: number
    cwd: string
}

export interface ComputerTerminalInfo {
    sessionId: string
    terminalId: string
    backend: ComputerBackendType
    url: string
    token: string
}

export type ComputerBackgroundJobState =
    | 'running'
    | 'completed'
    | 'failed'
    | 'killed'
    | 'timed_out'

export interface ComputerBackgroundJobInfo {
    id: string
    sessionId: string
    terminalId: string
    backend: ComputerBackendType
    url: string
    token: string
    command: string
    cwd: string
    state: ComputerBackgroundJobState
    startedAt: number
    endedAt?: number
    timeout?: number
    exitCode?: number
    output: string
}

export interface ComputerFileEntry {
    path: string
    type: 'file' | 'dir'
}

export interface ComputerDesktopState {
    sessionId: string
    backend: ComputerBackendType
    info?: {
        width: number
        height: number
        streamUrl?: string
    }
    screenshot?: {
        data: string
        mimeType: string
        width: number
        height: number
    }
}
