/** @module cli/types */

import type { Session } from 'koishi'
import type {
    ComputerBackendType,
    McpServerConfig,
    PermissionRule
} from '../types'
import type { ChatLunaAgentService } from '../service'

export type AgentCliPermission = 'read' | 'write' | 'dangerous'

export interface AgentCliLine {
    raw: string
    argv: string[]
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
    command: string
    summary: string
    op: AgentCliMutation
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
    args: string[]
}

export interface AgentCliCommand {
    path: string[]
    description: string
    permission: AgentCliPermission
    execute: (ctx: AgentCliCommandContext) => Promise<AgentCliCommandResult>
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
          type: 'set_tool_subagents'
          name: string
          rule: PermissionRule
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

export interface AgentCliOverview {
    skill: string
    configPath: string
    version: number
    skills: number
    subAgents: number
    tools: number
    mcpServers: number
    mcpTools: number
    computerBackends: ComputerBackendType[]
}
