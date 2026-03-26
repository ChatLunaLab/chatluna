/** @module types */

import type { DataService } from '@koishijs/plugin-console'
import type {
    ComputerBackendStatus,
    ComputerBackendType,
    ComputerBackgroundJobInfo,
    ComputerConfig,
    ComputerDesktopState,
    ComputerStatus,
    ComputerTerminalInfo
} from './types/computer'
import type {
    McpConfig,
    McpServerConfig,
    McpStatus,
    McpToolConfig
} from './types/mcp'
import type {
    SkillContentResult,
    SkillExportResult,
    SkillImportInput,
    SkillImportPreviewResult,
    SkillImportResult,
    SkillInfo,
    SkillMode,
    SkillsConfig,
    SkillsStatus
} from './types/skills'
import type {
    ManualSubAgentInput,
    SubAgentConfig,
    SubAgentExportResult,
    SubAgentImportInput,
    SubAgentInfo,
    SubAgentItemConfig,
    SubAgentRunInfo,
    SubAgentStatus
} from './types/sub_agent'
import type { ToolAvailabilityInfo, ToolConfig, ToolStatus } from './types/tool'

export * from './types/computer'
export * from './types/mcp'
export * from './types/skills'
export * from './types/sub_agent'
export * from './types/tool'

export interface AgentConfig {
    version: number
    mcp: McpConfig
    skills: SkillsConfig
    computer: ComputerConfig
    subAgent: SubAgentConfig
    tool: ToolConfig
}

export interface AgentStatus {
    mcp: McpStatus
    skills: SkillsStatus
    computer: ComputerStatus
    subAgent: SubAgentStatus
    tool: ToolStatus
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
        'chatluna-agent/getComputerStatus': () => Promise<ComputerStatus>
        'chatluna-agent/openComputerTerminal': (input?: {
            backend?: ComputerBackendType
            cwd?: string
            cols?: number
            rows?: number
        }) => Promise<ComputerTerminalInfo>
        'chatluna-agent/closeComputerTerminal': (
            sessionId: string,
            terminalId: string
        ) => Promise<ActionResult>
        'chatluna-agent/listComputerBackgroundJobs': (input?: {
            backend?: ComputerBackendType
        }) => Promise<ComputerBackgroundJobInfo[]>
        'chatluna-agent/killComputerBackgroundJob': (
            jobId: string
        ) => Promise<ActionResult>
        'chatluna-agent/removeComputerBackgroundJob': (
            jobId: string
        ) => Promise<ActionResult>
        'chatluna-agent/readComputerFile': (input: {
            path: string
            backend?: ComputerBackendType
            offset?: number
            limit?: number
        }) => Promise<string>
        'chatluna-agent/readComputerFileAsset': (input: {
            path: string
            backend?: ComputerBackendType
        }) => Promise<string>
        'chatluna-agent/globComputerFiles': (input: {
            pattern: string
            path?: string
            backend?: ComputerBackendType
        }) => Promise<string[]>
        'chatluna-agent/getComputerDesktop': (input?: {
            backend?: ComputerBackendType
        }) => Promise<ComputerDesktopState>
        'chatluna-agent/sendComputerDesktopAction': (
            sessionId: string,
            action:
                | {
                      type: 'click'
                      x: number
                      y: number
                      button?: 'left' | 'right' | 'middle'
                  }
                | { type: 'type'; text: string }
                | { type: 'key'; key: string }
                | {
                      type: 'scroll'
                      x: number
                      y: number
                      deltaX?: number
                      deltaY: number
                  }
                | {
                      type: 'drag'
                      startX: number
                      startY: number
                      endX: number
                      endY: number
                  }
        ) => Promise<ActionResult>
        'chatluna-agent/getSkills': () => Promise<SkillInfo[]>
        'chatluna-agent/getSkillContent': (
            id: string
        ) => Promise<SkillContentResult | undefined>
        'chatluna-agent/saveSkillContent': (
            id: string,
            content: string
        ) => Promise<ActionResult>
        'chatluna-agent/exportSkill': (
            id: string
        ) => Promise<SkillExportResult | undefined>
        'chatluna-agent/getSubAgents': () => Promise<SubAgentInfo[]>
        'chatluna-agent/getSubAgentRuns': () => Promise<SubAgentRunInfo[]>
        'chatluna-agent/addSubAgent': (
            input: ManualSubAgentInput
        ) => Promise<SubAgentInfo>
        'chatluna-agent/exportSubAgent': (
            id: string
        ) => Promise<SubAgentExportResult | undefined>
        'chatluna-agent/getModelNames': () => Promise<string[]>
        'chatluna-agent/importSkills': (
            input: SkillImportInput
        ) => Promise<SkillImportResult>
        'chatluna-agent/previewSkillImport': (
            input: SkillImportInput
        ) => Promise<SkillImportPreviewResult>
        'chatluna-agent/saveMcp': (
            config: AgentConfig['mcp']
        ) => Promise<ActionResult>
        'chatluna-agent/saveSkills': (
            config: AgentConfig['skills']
        ) => Promise<ActionResult>
        'chatluna-agent/saveComputer': (
            config: AgentConfig['computer']
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
        'chatluna-agent/reloadComputer': () => Promise<ActionResult>
        'chatluna-agent/reloadSkills': () => Promise<ActionResult>
        'chatluna-agent/reloadSubAgents': () => Promise<ActionResult>
        'chatluna-agent/testBackend': (
            type: ComputerBackendType
        ) => Promise<ComputerBackendStatus>
        'chatluna-agent/removeSkill': (id: string) => Promise<ActionResult>
        'chatluna-agent/setSkillEnabled': (
            id: string,
            enabled: boolean
        ) => Promise<ActionResult>
        'chatluna-agent/setSkillMode': (
            id: string,
            mode: SkillMode
        ) => Promise<ActionResult>
        'chatluna-agent/setSubAgentEnabled': (
            id: string,
            enabled: boolean
        ) => Promise<ActionResult>
        'chatluna-agent/uploadSubAgent': (
            input: SubAgentImportInput
        ) => Promise<ActionResult>
        'chatluna-agent/previewSubAgentImport': (data: string) => Promise<any>
        'chatluna-agent/createPresetAgent': (
            name: string,
            preset: string,
            config: Partial<SubAgentItemConfig>
        ) => Promise<ActionResult>
        'chatluna-agent/removeSubAgent': (id: string) => Promise<ActionResult>
        'chatluna-agent/getToolAvailability': () => Promise<
            ToolAvailabilityInfo[]
        >
        'chatluna-agent/getPresetNames': () => Promise<string[]>
        'chatluna-agent/reconnectMcpServer': (
            name: string
        ) => Promise<ActionResult>
        'chatluna-agent/refreshConsoleData': () => Promise<ActionResult>
    }
}
