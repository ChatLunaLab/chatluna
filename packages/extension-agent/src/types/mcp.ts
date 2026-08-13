/** @module types/mcp */

export type McpToolMode = 'eager' | 'catalog'

export interface McpConfig {
    mcpServers: Record<string, McpServerConfig>
    tools: Record<string, McpToolConfig>
    mcpToolMode?: McpToolMode
}

export interface McpIcon {
    src: string
    mimeType?: string
    theme?: 'light' | 'dark'
}

export type McpServerState =
    'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface McpServerConfig {
    command?: string
    args?: string[]
    env?: Record<string, string>
    type?: 'stdio' | 'sse' | 'http' | 'streamable_http'
    url?: string
    headers?: Record<string, string>
    /** MCP connection and tool discovery timeout in seconds. */
    startupTimeout?: number
    timeout?: number
    cwd?: string
    proxy?: string
}

export interface McpToolConfig {
    name: string
    enabled: boolean
    timeout?: number
    selector: string[]
}

export interface McpStatus {
    connected: boolean
    servers: Record<string, McpServerStatus>
    tools: Record<string, McpToolInfo>
}

export interface McpServerStatus {
    name: string
    state: McpServerState
    connected: boolean
    updating: boolean
    error?: string
    toolCount: number
    attempts: number
    maxAttempts: number
    pendingReconnect: boolean
    type?: string
    endpoint?: string
    title?: string
    version?: string
    icon?: McpIcon
}

export interface McpToolInfo {
    name: string
    description: string
    enabled: boolean
    updating: boolean
    server: string
    timeout?: number
    selector: string[]
    title?: string
    icon?: McpIcon
}
