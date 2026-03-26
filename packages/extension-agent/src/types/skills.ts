/** @module types/skills */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type { PermissionRule } from './tool'

export interface SkillsConfig {
    dirs: string[]
    items: Record<string, SkillConfig>
    githubToken?: string
}

export type SkillMode = 'off' | 'description' | 'full'

export interface SkillConfig {
    enabled: boolean
    mode?: SkillMode
    remote?: boolean
    main?: boolean
    chatluna?: boolean
    character?: boolean
    characterGroup?: boolean
    characterPrivate?: boolean
    characterGroupMode?: 'all' | 'allow' | 'deny'
    characterPrivateMode?: 'all' | 'allow' | 'deny'
    characterGroupIds?: string[]
    characterPrivateIds?: string[]
    subAgents?: PermissionRule
}

export type SkillSource =
    | 'chatluna'
    | 'openclaw'
    | 'codex'
    | 'universal'
    | 'claude'
    | 'opencode'
    | 'custom'

export type SkillScope = 'data' | 'project' | 'user'

export type SkillState = 'ready' | 'invalid' | 'missing'

export interface SkillRequires {
    bins?: string[]
    anyBins?: string[]
    env?: string[]
    config?: string[]
}

export interface SkillInstallAction {
    id: string
    kind: string
    label?: string
    bins?: string[]
    os?: string[]
    formula?: string
    package?: string
    url?: string
    archive?: string
    extract?: boolean
    stripComponents?: number
    targetDir?: string
}

export interface SkillInfo {
    id: string
    name: string
    description: string
    path: string
    dir: string
    remote?: boolean
    source: SkillSource
    scope: SkillScope
    state: SkillState
    enabled: boolean
    mode: SkillMode
    main: boolean
    chatlunaEnabled: boolean
    characterEnabled: boolean
    characterGroupEnabled: boolean
    characterPrivateEnabled: boolean
    characterGroupMode: 'all' | 'allow' | 'deny'
    characterPrivateMode: 'all' | 'allow' | 'deny'
    characterGroupIds: string[]
    characterPrivateIds: string[]
    subAgents: PermissionRule
    available: boolean
    visible: boolean
    modelEnabled: boolean
    userInvocable: boolean
    implicitInvocation: boolean
    shadowedBy?: string
    emoji?: string
    homepage?: string
    skillKey?: string
    primaryEnv?: string
    compatibility?: string
    license?: string
    metadata?: Record<string, string>
    requires?: SkillRequires
    install?: SkillInstallAction[]
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
    importName: string
    name: string
    description: string
    state: SkillState
    exists: boolean
    diagnostics: string[]
}

export type SkillImportInput =
    | {
          type: 'github'
          url: string
          selected?: string[]
      }
    | {
          type: 'zip'
          name: string
          data: string
          selected?: string[]
      }
    | {
          type: 'folder'
          name: string
          files: SkillImportFile[]
          selected?: string[]
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
