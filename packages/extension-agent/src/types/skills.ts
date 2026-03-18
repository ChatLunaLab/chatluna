/** @module types/skills */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'

export interface SkillsConfig {
    dirs: string[]
    items: Record<string, SkillConfig>
}

export interface SkillConfig {
    enabled: boolean
}

export type SkillSource =
    | 'chatluna'
    | 'codex'
    | 'universal'
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

export interface SkillImportPreviewEntry {
    path: string
    type: 'directory' | 'file'
}

export interface SkillImportPreviewItem {
    dir: string
    name: string
    description: string
    state: SkillState
    diagnostics: string[]
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

export interface SkillImportPreviewResult {
    source: SkillImportInput['type']
    target: string
    valid: boolean
    entries: SkillImportPreviewEntry[]
    skills: SkillImportPreviewItem[]
    diagnostics: string[]
}

export interface SkillExportResult {
    id: string
    name: string
    fileName: string
    data: string
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

export interface SkillToolService {
    buildToolDescription(): string
    activateSkill(
        name: string,
        runConfig?: ChatLunaToolRunnable
    ): Promise<string>
}
