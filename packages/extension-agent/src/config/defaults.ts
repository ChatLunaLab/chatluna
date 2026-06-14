/** @module config/defaults */

import {
    AgentConfig,
    ComputerConfig,
    createToolMetaOverride,
    PermissionRule,
    SkillConfig,
    SubAgentConfig,
    SubAgentItemConfig,
    ToolCharacterScope,
    ToolConfig,
    ToolItemConfig,
    ToolMetaOverride,
    TriggerConfig
} from '../types'
import { DEFAULT_SKILL_DIRS } from './path'

const HIGH_AUTHORITY_TOOLS = new Set([
    'bash',
    'file_edit',
    'file_read',
    'file_write',
    'glob',
    'grep',
    'trigger'
])

export function getDefaultToolAuthority(name?: string) {
    return name && HIGH_AUTHORITY_TOOLS.has(name) ? 3 : 0
}

export function createPermissionRule(
    mode: PermissionRule['mode'] = 'inherit'
): PermissionRule {
    return { mode, allow: [], deny: [] }
}

function copyRule(rule?: PermissionRule, mode: PermissionRule['mode'] = 'all') {
    return {
        mode: rule?.mode ?? mode,
        allow: [...(rule?.allow ?? [])],
        deny: [...(rule?.deny ?? [])]
    }
}

export function createSubAgentItemConfig(
    input: Partial<SubAgentItemConfig> = {}
): SubAgentItemConfig {
    return {
        enabled: input.enabled ?? true,
        dedupeTools: input.dedupeTools === true,
        name: input.name ?? '',
        description: input.description ?? '',
        chatluna: input.chatluna !== false,
        character: input.character !== false,
        characterGroup: input.characterGroup !== false,
        characterPrivate: input.characterPrivate !== false,
        characterGroupMode:
            input.characterGroupMode === 'allow' ||
            input.characterGroupMode === 'deny'
                ? input.characterGroupMode
                : 'all',
        characterPrivateMode:
            input.characterPrivateMode === 'allow' ||
            input.characterPrivateMode === 'deny'
                ? input.characterPrivateMode
                : 'all',
        characterGroupIds: [...(input.characterGroupIds ?? [])],
        characterPrivateIds: [...(input.characterPrivateIds ?? [])],
        authority: input.authority ?? 0,
        source: input.source ?? 'markdown',
        format: input.format ?? 'chatluna',
        model: input.model,
        maxTurns: input.maxTurns ?? 100,
        hidden: input.hidden ?? false,
        promptMode: input.promptMode ?? 'markdown',
        preset: input.preset,
        allowKoishiMessageTransform: input.allowKoishiMessageTransform ?? false,
        permissions: {
            skills: copyRule(input.permissions?.skills, 'inherit'),
            mcp: copyRule(input.permissions?.mcp, 'inherit'),
            tools: copyRule(input.permissions?.tools, 'inherit'),
            computer: copyRule(input.permissions?.computer, 'inherit')
        }
    }
}

export function createToolItemConfig(
    input: Partial<ToolItemConfig> = {},
    name?: string
): ToolItemConfig {
    return {
        enabled: input.enabled !== false,
        main: input.main !== false,
        chatluna: input.chatluna !== false,
        character: input.character !== false,
        characterGroup: input.characterGroup !== false,
        characterPrivate: input.characterPrivate !== false,
        characterGroupMode:
            input.characterGroupMode === 'allow' ||
            input.characterGroupMode === 'deny'
                ? input.characterGroupMode
                : 'all',
        characterPrivateMode:
            input.characterPrivateMode === 'allow' ||
            input.characterPrivateMode === 'deny'
                ? input.characterPrivateMode
                : 'all',
        characterGroupIds: [...(input.characterGroupIds ?? [])],
        characterPrivateIds: [...(input.characterPrivateIds ?? [])],
        subAgents: copyRule(input.subAgents, 'all'),
        authority: input.authority ?? getDefaultToolAuthority(name)
    }
}

export function createSkillItemConfig(
    input: Partial<SkillConfig> = {}
): SkillConfig {
    return {
        enabled: input.enabled !== false,
        mode:
            input.mode === 'description' || input.mode === 'full'
                ? input.mode
                : 'description',
        authority: input.authority ?? 0,
        remote: input.remote === true,
        main: input.main !== false,
        chatluna: input.chatluna !== false,
        character: input.character !== false,
        characterGroup: input.characterGroup !== false,
        characterPrivate: input.characterPrivate !== false,
        characterGroupMode:
            input.characterGroupMode === 'allow' ||
            input.characterGroupMode === 'deny'
                ? input.characterGroupMode
                : 'all',
        characterPrivateMode:
            input.characterPrivateMode === 'allow' ||
            input.characterPrivateMode === 'deny'
                ? input.characterPrivateMode
                : 'all',
        characterGroupIds: [...(input.characterGroupIds ?? [])],
        characterPrivateIds: [...(input.characterPrivateIds ?? [])],
        subAgents: copyRule(input.subAgents, 'all')
    }
}

// -- Tool registry helpers --

function toolEntry(
    source: string,
    group: string,
    tags: string[],
    scope: ToolCharacterScope = 'all',
    enabled = true
): ToolMetaOverride {
    return createToolMetaOverride({
        source,
        group,
        tags,
        defaultAvailability: {
            enabled,
            main: enabled,
            chatluna: enabled,
            characterScope: scope
        }
    })
}

function builtinEntry(scope: ToolCharacterScope = 'all'): ToolMetaOverride {
    return createToolMetaOverride({
        defaultAvailability: {
            enabled: true,
            main: true,
            chatluna: true,
            characterScope: scope
        }
    })
}

function buildBrowserRegistry(): Record<string, ToolMetaOverride> {
    const web = ['browser', 'web']
    const debug = ['browser', 'web', 'debug']
    const input = ['browser', 'web', 'input']

    const entries: [string, string[]][] = [
        ['browser_open', web],
        ['browser_list_pages', web],
        ['browser_select_page', web],
        ['browser_close_page', web],
        ['browser_navigate', web],
        ['browser_read_text', web],
        ['browser_get_html', web],
        ['browser_get_links', web],
        ['browser_summarize', web],
        ['browser_snapshot', web],
        ['browser_wait_for', web],
        ['browser_screenshot', debug],
        ['browser_click', input],
        ['browser_hover', input],
        ['browser_fill', input],
        ['browser_fill_form', input],
        ['browser_type', input],
        ['browser_press_key', input],
        ['browser_upload_file', input],
        ['browser_console', debug],
        ['browser_network', debug]
    ]

    const registry: Record<string, ToolMetaOverride> = {}
    for (const [name, tags] of entries) {
        registry[name] = toolEntry('extension', 'browser', tags)
    }
    // browser_evaluate is disabled by default
    registry.browser_evaluate = toolEntry(
        'extension',
        'browser',
        debug,
        'none',
        false
    )
    return registry
}

export function createDefaultToolConfig(): ToolConfig {
    return {
        items: {},
        registry: {
            web_search: toolEntry('extension', 'search', ['search', 'web']),
            ...buildBrowserRegistry(),
            group_mute: toolEntry(
                'extension',
                'plugin-common',
                ['plugin-common', 'group', 'moderation'],
                'group'
            ),
            file_read: builtinEntry(),
            file_write: builtinEntry(),
            file_edit: builtinEntry(),
            file_publish: builtinEntry(),
            grep: builtinEntry(),
            glob: builtinEntry(),
            bash: builtinEntry(),
            task: toolEntry('extension', 'agent', ['handoff'])
        }
    }
}

export function createDefaultSubAgentConfig(): SubAgentConfig {
    return {
        dirs: [],
        items: {},
        builtin: {
            plan: createSubAgentItemConfig({
                enabled: false,
                name: 'plan',
                description:
                    'Read-only architect agent for designing implementation ' +
                    'plans. Use when you need to analyze code, assess impact, ' +
                    'identify constraints, and produce step-by-step plans ' +
                    'before making changes. Returns structured plans with file ' +
                    'paths, key changes, and risk assessment.',
                source: 'builtin',
                format: 'chatluna'
            }),
            general: createSubAgentItemConfig({
                enabled: false,
                name: 'general',
                description:
                    'Full-capability development agent for multi-step ' +
                    'implementation tasks. Use when you need to read code, ' +
                    'make changes across files, run builds or tests, and ' +
                    'report results. Has access to file_read, file_write, ' +
                    'file_edit, grep, glob, and bash.',
                source: 'builtin',
                format: 'chatluna'
            }),
            explore: createSubAgentItemConfig({
                enabled: false,
                name: 'explore',
                description:
                    'Fast read-only search agent for codebase exploration. ' +
                    'Use when you need to quickly find files, search for ' +
                    'symbols, trace imports, or gather context. Returns ' +
                    'precise file paths, line numbers, and code snippets.',
                source: 'builtin',
                format: 'chatluna'
            })
        },
        presetAgents: {},
        defaults: {
            skills: createPermissionRule('deny'),
            mcp: createPermissionRule('deny'),
            tools: createPermissionRule('deny'),
            computer: createPermissionRule('allow')
        }
    }
}

export function createDefaultComputerConfig(): ComputerConfig {
    return {
        defaultProvider: 'e2b',
        idleTimeoutMs: 600000,
        local: {
            enabled: false,
            sandboxMode: 'workspace-write',
            approvalMode: 'on-request',
            dangerouslySkipPermissions: false,
            preferredShell: 'auto',
            scopePath: '',
            readOnlyRoots: [],
            denyRoots: [],
            ignores: [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/build/**',
                '**/.yarn/**',
                '**/coverage/**',
                '**/.next/**',
                '**/.nuxt/**',
                '**/out/**',
                '**/.cache/**',
                '**/.vscode/**',
                '**/.idea/**',
                '**/temp/**',
                '**/tmp/**'
            ],
            allowedCommands: [],
            blockedCommands: [],
            commandTimeoutMs: 30000,
            networkPolicy: 'block'
        },
        e2b: {
            enabled: false,
            apiKey: '',
            template: 'base',
            desktopTemplate: '',
            timeoutMs: 300000,
            keepAlive: true
        },
        openTerminal: {
            enabled: false,
            baseUrl: '',
            apiKey: '',
            deploymentMode: 'unknown',
            userIsolation: false
        }
    }
}

export function createDefaultTriggerConfig(): TriggerConfig {
    return {
        providers: {
            cron: { enabled: true },
            activity: { enabled: true },
            keyword: { enabled: true }
        }
    }
}

export function getDefaultConfig(): AgentConfig {
    return {
        version: 4,
        mcp: {
            mcpServers: {},
            tools: {}
        },
        skills: {
            dirs: [...DEFAULT_SKILL_DIRS],
            items: {},
            githubToken: ''
        },
        computer: createDefaultComputerConfig(),
        subAgent: createDefaultSubAgentConfig(),
        tool: createDefaultToolConfig(),
        trigger: createDefaultTriggerConfig()
    }
}
