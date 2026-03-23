/** @module types/tool */

export interface ToolMetaOverride {
    source?: string
    group?: string
    tags?: string[]
    defaultEnabled?: boolean
    defaultMain?: boolean
    defaultChatluna?: boolean
    defaultCharacter?: boolean
    defaultCharacterGroup?: boolean
    defaultCharacterPrivate?: boolean
}

export interface PermissionRule {
    mode: 'inherit' | 'all' | 'allow' | 'deny'
    allow: string[]
    deny: string[]
}

export interface ToolItemConfig {
    enabled: boolean
    main: boolean
    chatluna: boolean
    character: boolean
    characterGroup: boolean
    characterPrivate: boolean
    characterGroupMode: 'all' | 'allow' | 'deny'
    characterPrivateMode: 'all' | 'allow' | 'deny'
    characterGroupIds: string[]
    characterPrivateIds: string[]
    subAgents: PermissionRule
    authority: number
}

export interface ToolConfig {
    items: Record<string, ToolItemConfig>
    registry?: Record<string, ToolMetaOverride>
}

export interface ToolInfo {
    name: string
    description?: string
    enabled: boolean
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
    authority: number
    source?: string
    group?: string
    tags?: string[]
    isMcp: boolean
    serverName?: string
}

export interface ToolAvailabilityInfo {
    name: string
    description?: string
    enabled: boolean
    main: boolean
    chatlunaEnabled: boolean
    characterEnabled: boolean
    characterGroupEnabled: boolean
    characterPrivateEnabled: boolean
    characterGroupMode: 'all' | 'allow' | 'deny'
    characterPrivateMode: 'all' | 'allow' | 'deny'
    agents: string[]
    source?: string
    group?: string
    tags?: string[]
}

export interface ToolStatus {
    enabled: boolean
    total: number
    mainEnabled: number
    subAgentEnabled: number
    catalog: Record<string, ToolInfo>
}
