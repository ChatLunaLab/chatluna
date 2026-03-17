/** @module config/defaults */

import {
    AgentConfig,
    ComputerConfig,
    PermissionRule,
    SubAgentConfig,
    SubAgentItemConfig,
    ToolConfig,
    ToolItemConfig
} from '../types'

export function createPermissionRule(
    mode: PermissionRule['mode'] = 'inherit'
): PermissionRule {
    return {
        mode,
        allow: [],
        deny: []
    }
}

export function createSubAgentItemConfig(
    input: Partial<SubAgentItemConfig> = {}
): SubAgentItemConfig {
    return {
        enabled: input.enabled ?? true,
        name: input.name ?? '',
        description: input.description ?? '',
        source: input.source ?? 'markdown',
        format: input.format ?? 'chatluna',
        model: input.model,
        maxTurns: input.maxTurns ?? 100,
        hidden: input.hidden ?? false,
        promptMode: input.promptMode ?? 'markdown',
        preset: input.preset,
        allowKoishiMessageTransform: input.allowKoishiMessageTransform ?? false,
        permissions: {
            skills:
                input.permissions?.skills ?? createPermissionRule('inherit'),
            mcp: input.permissions?.mcp ?? createPermissionRule('inherit'),
            tools: input.permissions?.tools ?? createPermissionRule('inherit'),
            computer:
                input.permissions?.computer ?? createPermissionRule('deny')
        }
    }
}

export function createToolItemConfig(
    input: Partial<ToolItemConfig> = {}
): ToolItemConfig {
    return {
        enabled: input.enabled !== false,
        main: input.main !== false,
        subAgents: input.subAgents ?? createPermissionRule('all')
    }
}

export function createDefaultToolConfig(): ToolConfig {
    return {
        items: {},
        registry: {}
    }
}

export function createDefaultSubAgentConfig(): SubAgentConfig {
    return {
        dirs: ['~/.claude/agents', '~/.config/opencode/agents'],
        items: {},
        builtin: {
            plan: createSubAgentItemConfig({
                enabled: false,
                name: 'plan',
                description:
                    'Read-only architect agent for designing implementation plans. Use when you need to analyze code, assess impact, identify constraints, and produce step-by-step plans before making changes. Returns structured plans with file paths, key changes, and risk assessment.',
                source: 'builtin',
                format: 'chatluna'
            }),
            general: createSubAgentItemConfig({
                enabled: false,
                name: 'general',
                description:
                    'Full-capability development agent for multi-step implementation tasks. Use when you need to read code, make changes across files, run builds or tests, and report results. Has access to file_read, file_write, file_edit, grep, glob, and bash.',
                source: 'builtin',
                format: 'chatluna'
            }),
            explore: createSubAgentItemConfig({
                enabled: false,
                name: 'explore',
                description:
                    'Fast read-only search agent for codebase exploration. Use when you need to quickly find files, search for symbols, trace imports, or gather context. Returns precise file paths, line numbers, and code snippets.',
                source: 'builtin',
                format: 'chatluna'
            })
        },
        presetAgents: {},
        defaults: {
            skills: createPermissionRule('deny'),
            mcp: createPermissionRule('inherit'),
            tools: createPermissionRule('inherit'),
            computer: createPermissionRule('deny')
        }
    }
}

export function createDefaultComputerConfig(): ComputerConfig {
    return {
        defaultProvider: 'local',
        idleTimeoutMs: 600000,
        local: {
            enabled: true,
            sandboxMode: 'workspace-write',
            approvalMode: 'on-request',
            dangerouslySkipPermissions: false,
            preferredShell: 'auto',
            scopePath: '',
            writableRoots: [],
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

export function getDefaultConfig(): AgentConfig {
    return {
        version: 4,
        mcp: {
            mcpServers: {},
            tools: {}
        },
        skills: {
            allowComputerUsePrompt: false,
            dirs: [
                '~/.agents/skills',
                '~/.codex/skills',
                '~/.claude/skills',
                '~/.config/opencode/skills'
            ],
            items: {}
        },
        computer: createDefaultComputerConfig(),
        subAgent: createDefaultSubAgentConfig(),
        tool: createDefaultToolConfig()
    }
}
