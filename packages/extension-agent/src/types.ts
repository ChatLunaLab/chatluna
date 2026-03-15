import type { DataService } from '@koishijs/plugin-console'

export interface AgentConfig {
    version: number
    mcp: McpConfig
    skills: SkillsConfig
    computer: Record<string, unknown>
    subAgent: SubAgentConfig
    tool: {
        registry?: Record<string, ToolMetaOverride>
    }
}

export interface ToolMetaOverride {
    source?: string
    group?: string
    tags?: string[]
}

export interface SkillsConfig {
    allowComputerUsePrompt: boolean
    dirs: string[]
    items: Record<string, SkillConfig>
}

export interface SkillConfig {
    enabled: boolean
}

export type SkillSource =
    | 'chatluna'
    | 'codex'
    | 'claude'
    | 'opencode'
    | 'custom'

export type SkillScope = 'data' | 'project' | 'user'

export type SkillState = 'ready' | 'invalid' | 'missing'

export interface SkillInfo {
    id: string
    name: string
    description: string
    path: string
    dir: string
    source: SkillSource
    scope: SkillScope
    state: SkillState
    enabled: boolean
    visible: boolean
    modelEnabled: boolean
    userInvocable: boolean
    implicitInvocation: boolean
    shadowedBy?: string
    compatibility?: string
    license?: string
    metadata?: Record<string, string>
    allowedTools?: string[]
    diagnostics: string[]
}

export interface SkillContentResult {
    id: string
    content: string
}

export interface SkillImportFile {
    path: string
    data: string
}

export type SkillImportInput =
    | {
          type: 'github'
          url: string
      }
    | {
          type: 'zip'
          name: string
          data: string
      }
    | {
          type: 'folder'
          name: string
          files: SkillImportFile[]
      }

export interface SkillImportResult {
    source: SkillImportInput['type']
    imported: string[]
    replaced: string[]
    diagnostics: string[]
}

export interface SkillExportResult {
    id: string
    name: string
    fileName: string
    data: string
}

export interface McpConfig {
    mcpServers: Record<string, McpServerConfig>
    tools: Record<string, McpToolConfig>
}

export interface McpIcon {
    src: string
    mimeType?: string
    theme?: 'light' | 'dark'
}

export type McpServerState =
    | 'idle'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'error'

export interface McpServerConfig {
    command?: string
    args?: string[]
    env?: Record<string, string>
    type?: 'stdio' | 'sse' | 'http' | 'streamable_http'
    url?: string
    headers?: Record<string, string>
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
    stateText: string
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

export interface PermissionRule {
    mode: 'inherit' | 'all' | 'allow' | 'deny'
    allow: string[]
    deny: string[]
}

export interface SubAgentPermissionConfig {
    skills: PermissionRule
    mcp: PermissionRule
    tools: PermissionRule
    computer: PermissionRule
}

export interface SubAgentItemConfig {
    enabled: boolean
    name: string
    description: string
    source: 'builtin' | 'markdown' | 'preset'
    format: 'chatluna' | 'claude' | 'opencode'
    model?: string
    maxTurns?: number
    hidden?: boolean
    promptMode: 'markdown' | 'preset'
    preset?: string
    allowKoishiMessageTransform: boolean
    permissions: SubAgentPermissionConfig
}

export interface SubAgentConfig {
    dirs: string[]
    items: Record<string, SubAgentItemConfig>
    builtin: {
        plan: SubAgentItemConfig
        general: SubAgentItemConfig
        explore: SubAgentItemConfig
    }
    presetAgents: Record<string, SubAgentItemConfig>
    defaults: SubAgentPermissionConfig
}

export interface SubAgentInfo {
    id: string
    name: string
    description: string
    source: 'builtin' | 'markdown' | 'preset'
    format: 'chatluna' | 'claude' | 'opencode'
    state: 'ready' | 'invalid' | 'missing'
    enabled: boolean
    hidden: boolean
    path?: string
    scope?: 'data' | 'project' | 'user'
    priority: number
    promptContent: string
    model?: string
    maxTurns?: number
    permissions: SubAgentPermissionConfig
    allowKoishiMessageTransform: boolean
    diagnostics: string[]
    shadowedBy?: string
    promptMode: 'markdown' | 'preset'
    preset?: string
}

export interface SubAgentRunInfo {
    runId: string
    agentId: string
    agentName: string
    parentConversationId: string
    depth: number
    state: 'running' | 'completed' | 'failed' | 'aborted'
    startedAt: number
    endedAt?: number
    lastTool?: string
    toolCount: number
    turnCount: number
    error?: string
}

export interface ToolGrantInfo {
    name: string
    agents: string[]
    source?: string
    group?: string
    tags?: string[]
}

export interface SubAgentImportInput {
    name: string
    data: string
}

export interface SubAgentStatus {
    enabled: boolean
    total: number
    catalog: Record<string, SubAgentInfo>
    runs: SubAgentRunInfo[]
}

export interface SkillsStatus {
    enabled: boolean
    root: string
    total: number
    visible: number
    modelEnabled: number
    activeConversations: number
    catalog: Record<string, SkillInfo>
}

export interface AgentStatus {
    mcp: McpStatus
    skills: SkillsStatus
    subAgent: SubAgentStatus
}

export interface AgentConsoleData {
    config: AgentConfig
    status: AgentStatus
}

export interface ActionResult {
    success: boolean
}

export interface SaveMcpServerInput {
    oldName?: string
    name: string
    config: McpServerConfig
}

declare module 'koishi' {
    interface Context {
        chatluna_agent_webui: DataService<AgentConsoleData>
    }
}

declare module '@koishijs/plugin-console' {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Console {
        interface Services {
            chatluna_agent_webui: DataService<AgentConsoleData>
        }
    }

    interface Events {
        'chatluna-agent/getConfig': () => Promise<AgentConfig>
        'chatluna-agent/saveConfig': (
            config: AgentConfig
        ) => Promise<ActionResult>
        'chatluna-agent/getStatus': () => Promise<AgentStatus>
        'chatluna-agent/getMcpStatus': () => Promise<McpStatus>
        'chatluna-agent/getSkills': () => Promise<SkillInfo[]>
        'chatluna-agent/getSkillContent': (
            id: string
        ) => Promise<SkillContentResult | undefined>
        'chatluna-agent/exportSkill': (
            id: string
        ) => Promise<SkillExportResult | undefined>
        'chatluna-agent/getSubAgents': () => Promise<SubAgentInfo[]>
        'chatluna-agent/getSubAgentRuns': () => Promise<SubAgentRunInfo[]>
        'chatluna-agent/getModelNames': () => Promise<string[]>
        'chatluna-agent/importSkills': (
            input: SkillImportInput
        ) => Promise<SkillImportResult>
        'chatluna-agent/saveMcp': (
            config: AgentConfig['mcp']
        ) => Promise<ActionResult>
        'chatluna-agent/saveSkills': (
            config: AgentConfig['skills']
        ) => Promise<ActionResult>
        'chatluna-agent/saveSubAgentConfig': (
            config: AgentConfig['subAgent']
        ) => Promise<ActionResult>
        'chatluna-agent/upsertMcpServer': (
            name: string,
            config: McpServerConfig
        ) => Promise<ActionResult>
        'chatluna-agent/saveMcpServer': (
            input: SaveMcpServerInput
        ) => Promise<ActionResult>
        'chatluna-agent/removeMcpServer': (
            name: string
        ) => Promise<ActionResult>
        'chatluna-agent/toggleMcpTool': (
            name: string,
            enabled: boolean
        ) => Promise<ActionResult>
        'chatluna-agent/saveMcpTool': (
            config: McpToolConfig
        ) => Promise<ActionResult>
        'chatluna-agent/reloadMcp': () => Promise<ActionResult>
        'chatluna-agent/reloadSkills': () => Promise<ActionResult>
        'chatluna-agent/reloadSubAgents': () => Promise<ActionResult>
        'chatluna-agent/removeSkill': (id: string) => Promise<ActionResult>
        'chatluna-agent/setSkillEnabled': (
            id: string,
            enabled: boolean
        ) => Promise<ActionResult>
        'chatluna-agent/setSubAgentEnabled': (
            id: string,
            enabled: boolean
        ) => Promise<ActionResult>
        'chatluna-agent/uploadSubAgent': (
            input: SubAgentImportInput
        ) => Promise<ActionResult>
        'chatluna-agent/createPresetAgent': (
            name: string,
            preset: string,
            config: Partial<SubAgentItemConfig>
        ) => Promise<ActionResult>
        'chatluna-agent/removeSubAgent': (id: string) => Promise<ActionResult>
        'chatluna-agent/getToolGrants': () => Promise<ToolGrantInfo[]>
        'chatluna-agent/getPresetNames': () => Promise<string[]>
        'chatluna-agent/reconnectMcpServer': (
            name: string
        ) => Promise<ActionResult>
        'chatluna-agent/refreshConsoleData': () => Promise<ActionResult>
    }
}
