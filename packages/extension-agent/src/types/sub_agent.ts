/** @module types/sub_agent */

import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type { PermissionRule } from './tool'

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
    source: 'builtin' | 'markdown' | 'preset' | 'manual'
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
    source: 'builtin' | 'markdown' | 'preset' | 'manual'
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
    taskId: string
    agentId: string
    agentName: string
    conversationId: string
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

export interface SubAgentImportInput {
    name: string
    data: string
}

export interface ManualSubAgentInput {
    id?: string
    name: string
    description?: string
    promptContent?: string
    format?: SubAgentInfo['format']
    model?: string
    maxTurns?: number
    hidden?: boolean
    enabled?: boolean
    allowKoishiMessageTransform?: boolean
    permissions?: SubAgentPermissionConfig
    priority?: number
    promptMode?: 'markdown' | 'preset'
    preset?: string
}

export interface ManualSubAgentRegistration {
    agent: SubAgentInfo
    dispose: () => Promise<void>
}

export interface SubAgentStatus {
    enabled: boolean
    total: number
    catalog: Record<string, SubAgentInfo>
    runs: SubAgentRunInfo[]
}

export interface SubAgentTaskService {
    buildToolDescription(): string
    runTask(
        input: {
            agent: string
            id?: string
            prompt: string
            reason?: string
        },
        runConfig?: ChatLunaToolRunnable
    ): Promise<string>
}
