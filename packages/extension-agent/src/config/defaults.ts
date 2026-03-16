import {
    AgentConfig,
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

export function getDefaultConfig(): AgentConfig {
    return {
        version: 3,
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
        computer: {},
        subAgent: createDefaultSubAgentConfig(),
        tool: createDefaultToolConfig()
    }
}
