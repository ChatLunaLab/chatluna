/** @module cli/types */

import type { Session } from 'koishi'
import type {
    ComputerBackendType,
    McpServerConfig,
    PermissionRule
} from '../types'
import type { ChatLunaAgentService } from '../service'

export type AgentCliPermission = 'read' | 'write' | 'dangerous'
export type AgentCliOperator = '&' | '&&' | '|' | '|&' | '||' | ';'

export const AGENTCLI_TOOL_NAME = 'agentcli'
export const AGENTCLI_SKILL_NAME = 'agent-config-admin'
export const AGENTCLI_PROMPT_MARKER = '[agentcli session]'
export const AGENTCLI_SANDBOX_SUBAGENTS_ROOT = '~/.chatluna/agents'

export interface AgentCliCall {
    raw: string
    argv: string[]
    join?: AgentCliOperator
}

export interface AgentCliLine {
    raw: string
    calls: AgentCliCall[]
}

export interface AgentCliBlock {
    raw: string
    body: string
    lines: AgentCliLine[]
}

export interface AgentCliRunResult {
    input: string
    exitCode: number
    status: 'ok' | 'preview' | 'applied' | 'cancelled' | 'error'
    stdout: string[]
    stderr: string[]
    createdAt: number
}

export interface AgentCliPending {
    id: string
    ownerId: string
    commands: string[]
    summary: string
    ops: AgentCliMutation[]
    createdAt: number
}

export interface AgentCliSessionState {
    conversationId: string
    userId: string
    permissions: AgentCliPermission[]
    updatedAt: number
    last?: AgentCliRunResult
    pending?: AgentCliPending
}

export interface AgentCliCommandResult {
    status?: AgentCliRunResult['status']
    stdout?: string[]
    stderr?: string[]
    pending?: AgentCliPending
    clearPending?: boolean
}

export interface AgentCliCommandContext {
    agent: ChatLunaAgentService
    conversationId: string
    session: Session
    state: AgentCliSessionState
    line: AgentCliLine
    call: AgentCliCall
    args: string[]
}

export interface AgentCliCommand {
    path: string[]
    description: string
    permission: AgentCliPermission
    execute: (ctx: AgentCliCommandContext) => Promise<AgentCliCommandResult>
}

export interface AgentCliSyncFile {
    kind: 'skill' | 'subagent'
    path: string
    sourcePath: string
    targetPath: string
    content: string
    mode: 'create' | 'update'
}

export type AgentCliMutation =
    | {
          type: 'set_skill_enabled'
          id: string
          enabled: boolean
          label: string
      }
    | {
          type: 'remove_skill'
          id: string
          label: string
      }
    | {
          type: 'set_subagent_enabled'
          id: string
          enabled: boolean
          label: string
      }
    | {
          type: 'remove_subagent'
          id: string
          label: string
      }
    | {
          type: 'set_subagent_rule'
          id: string
          field: 'tools' | 'skills' | 'mcp' | 'computer'
          rule: PermissionRule
          label: string
      }
    | {
          type: 'set_tool_enabled'
          name: string
          enabled: boolean
      }
    | {
          type: 'set_tool_main'
          name: string
          main: boolean
      }
    | {
          type: 'set_tool_chatluna'
          name: string
          chatluna: boolean
      }
    | {
          type: 'set_tool_character'
          name: string
          character: boolean
      }
    | {
          type: 'set_tool_group'
          name: string
          group: boolean
      }
    | {
          type: 'set_tool_private'
          name: string
          private: boolean
      }
    | {
          type: 'set_tool_subagents'
          name: string
          rule: PermissionRule
      }
    | {
          type: 'set_tool_authority'
          name: string
          authority: number
      }
    | {
          type: 'set_mcp_tool_enabled'
          name: string
          enabled: boolean
      }
    | {
          type: 'save_mcp_server'
          name: string
          config: McpServerConfig
      }
    | {
          type: 'remove_mcp_server'
          name: string
      }
    | {
          type: 'sync_sandbox'
          backend: ComputerBackendType
          files: AgentCliSyncFile[]
      }

export interface AgentCliOverview {
    skill: string
    configPath: string
    localSkillsDir: string
    localSubAgentsDir: string
    sandboxSkillsDir: string
    sandboxSubAgentsDir: string
    defaultBackend: ComputerBackendType
    version: number
    skills: number
    visibleSkills: number
    modelSkills: number
    subAgents: number
    tools: number
    mainTools: number
    subAgentTools: number
    mcpServers: number
    mcpTools: number
    computerBackends: ComputerBackendType[]
}
