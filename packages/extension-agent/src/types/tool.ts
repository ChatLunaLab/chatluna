/** @module types/tool */

export type ToolCharacterScope = 'all' | 'group' | 'private' | 'none'

export interface ToolDefaultAvailability {
    enabled?: boolean
    main?: boolean
    subAgent?: boolean
    chatluna?: boolean
    characterScope?: ToolCharacterScope
}

interface ToolMetaAvailabilityInput {
    defaultAvailability?: ToolDefaultAvailability
    defaultEnabled?: boolean
    defaultMain?: boolean
    defaultChatluna?: boolean
    defaultCharacter?: boolean
    defaultCharacterGroup?: boolean
    defaultCharacterPrivate?: boolean
}

export interface ToolMetaOverride {
    source?: string
    group?: string
    tags?: string[]
    defaultAvailability?: ToolDefaultAvailability
    /** @deprecated use defaultAvailability */
    defaultEnabled?: boolean
    /** @deprecated use defaultAvailability */
    defaultMain?: boolean
    /** @deprecated use defaultAvailability */
    defaultChatluna?: boolean
    /** @deprecated use defaultAvailability */
    defaultCharacter?: boolean
    /** @deprecated use defaultAvailability */
    defaultCharacterGroup?: boolean
    /** @deprecated use defaultAvailability */
    defaultCharacterPrivate?: boolean
}

export function createToolDefaultAvailability(
    input: ToolMetaAvailabilityInput = {}
): ToolDefaultAvailability | undefined {
    const hasEnabled =
        input.defaultAvailability?.enabled != null ||
        input.defaultEnabled != null
    const hasMain =
        input.defaultAvailability?.main != null || input.defaultMain != null
    const hasSubAgent = input.defaultAvailability?.subAgent != null
    const hasChatluna =
        input.defaultAvailability?.chatluna != null ||
        input.defaultChatluna != null
    const hasCharacter =
        input.defaultAvailability?.characterScope != null ||
        input.defaultCharacter != null ||
        input.defaultCharacterGroup != null ||
        input.defaultCharacterPrivate != null

    if (
        !hasEnabled &&
        !hasMain &&
        !hasSubAgent &&
        !hasChatluna &&
        !hasCharacter
    ) {
        return undefined
    }

    const output: ToolDefaultAvailability = {}

    if (hasEnabled) {
        output.enabled =
            input.defaultAvailability?.enabled ?? input.defaultEnabled
    }

    if (hasMain) {
        output.main = input.defaultAvailability?.main ?? input.defaultMain
    }

    if (hasSubAgent) {
        output.subAgent = input.defaultAvailability?.subAgent
    }

    if (hasChatluna) {
        output.chatluna =
            input.defaultAvailability?.chatluna ?? input.defaultChatluna
    }

    if (hasCharacter) {
        if (input.defaultAvailability?.characterScope != null) {
            output.characterScope = input.defaultAvailability.characterScope
        } else if (input.defaultCharacter === false) {
            output.characterScope = 'none'
        } else {
            const group = input.defaultCharacterGroup !== false
            const privateChat = input.defaultCharacterPrivate !== false

            if (group && privateChat) {
                output.characterScope = 'all'
            } else if (group) {
                output.characterScope = 'group'
            } else if (privateChat) {
                output.characterScope = 'private'
            } else {
                output.characterScope = 'none'
            }
        }
    }

    return output
}

export function createToolMetaOverride(
    input: ToolMetaOverride = {}
): ToolMetaOverride {
    const output: ToolMetaOverride = {}

    if (input.source != null) {
        output.source = input.source
    }

    if (input.group != null) {
        output.group = input.group
    }

    if (input.tags != null) {
        output.tags = [...input.tags]
    }

    const defaultAvailability = createToolDefaultAvailability(input)
    if (defaultAvailability != null) {
        output.defaultAvailability = defaultAvailability
    }

    return output
}

export interface PermissionRule {
    mode: 'inherit' | 'all' | 'allow' | 'deny'
    allow: string[]
    deny: string[]
}

export interface ToolItemConfig {
    enabled: boolean
    main: boolean
    subAgent?: boolean
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
    subAgent: boolean
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
