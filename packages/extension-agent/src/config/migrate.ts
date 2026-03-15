import {
    AgentConfig,
    McpServerConfig,
    PermissionRule,
    SubAgentConfig,
    SubAgentItemConfig
} from '../types'
import {
    createDefaultSubAgentConfig,
    createPermissionRule,
    createSubAgentItemConfig,
    getDefaultConfig
} from './defaults'

interface OldConfig {
    version?: number
    mcp?: {
        servers?: string
        mcpServers?: Record<
            string,
            McpServerConfig & { environment?: Record<string, string> }
        >
        tools?: Record<string, unknown>
    }
    skills?:
        | AgentConfig['skills']
        | Record<string, { enabled?: boolean } | boolean | unknown>
    computer?: Record<string, unknown>
    scheduler?: Record<string, unknown>
    subAgent?: unknown
    tool?: unknown
}

function asObject(value: unknown) {
    if (typeof value !== 'object' || value == null) {
        return undefined
    }

    return value as Record<string, unknown>
}

function readNames(value: unknown) {
    if (!Array.isArray(value)) {
        return []
    }

    return value
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)
}

function migrateRule(
    value: unknown,
    fallback: PermissionRule = createPermissionRule('inherit')
): PermissionRule {
    const item = asObject(value)
    if (!item) {
        return {
            mode: fallback.mode,
            allow: [...fallback.allow],
            deny: [...fallback.deny]
        }
    }

    const mode =
        item.mode === 'inherit' ||
        item.mode === 'all' ||
        item.mode === 'allow' ||
        item.mode === 'deny'
            ? item.mode
            : fallback.mode

    return {
        mode,
        allow: readNames(item.allow),
        deny: readNames(item.deny)
    }
}

function migrateSubAgentItem(
    value: unknown,
    fallback: SubAgentItemConfig
): SubAgentItemConfig {
    if (typeof value === 'boolean') {
        return createSubAgentItemConfig({
            ...fallback,
            enabled: value
        })
    }

    const item = asObject(value)
    if (!item) {
        return fallback
    }

    const permissions = asObject(item.permissions)

    return createSubAgentItemConfig({
        ...fallback,
        enabled: item.enabled !== false,
        name: typeof item.name === 'string' ? item.name : fallback.name,
        description:
            typeof item.description === 'string'
                ? item.description
                : fallback.description,
        source:
            item.source === 'builtin' ||
            item.source === 'markdown' ||
            item.source === 'preset'
                ? item.source
                : fallback.source,
        format:
            item.format === 'chatluna' ||
            item.format === 'claude' ||
            item.format === 'opencode'
                ? item.format
                : fallback.format,
        model: typeof item.model === 'string' ? item.model : fallback.model,
        maxTurns:
            typeof item.maxTurns === 'number'
                ? item.maxTurns
                : fallback.maxTurns,
        hidden: item.hidden === true,
        promptMode:
            item.promptMode === 'preset' ? 'preset' : fallback.promptMode,
        preset: typeof item.preset === 'string' ? item.preset : fallback.preset,
        allowKoishiMessageTransform: item.allowKoishiMessageTransform === true,
        permissions: {
            skills: migrateRule(
                permissions?.skills,
                fallback.permissions.skills
            ),
            mcp: migrateRule(permissions?.mcp, fallback.permissions.mcp),
            tools: migrateRule(permissions?.tools, fallback.permissions.tools),
            computer: migrateRule(
                permissions?.computer,
                fallback.permissions.computer
            )
        }
    })
}

function migrateSubAgentConfig(old?: OldConfig['subAgent']): SubAgentConfig {
    const cfg = createDefaultSubAgentConfig()
    const raw = asObject(old)

    if (!raw) {
        return cfg
    }

    if (Array.isArray(raw.dirs)) {
        cfg.dirs = raw.dirs
            .map(String)
            .map((item) => item.trim())
            .filter(
                (item, idx, list) =>
                    item.length > 0 && list.indexOf(item) === idx
            )
    }

    const items = asObject(raw.items)
    if (items) {
        cfg.items = Object.fromEntries(
            Object.entries(items).map(([id, value]) => {
                const current = asObject(value)
                return [
                    id,
                    migrateSubAgentItem(
                        value,
                        createSubAgentItemConfig({
                            name:
                                typeof current?.name === 'string'
                                    ? current.name
                                    : ''
                        })
                    )
                ]
            })
        )
    }

    const builtin = asObject(raw.builtin)
    if (builtin) {
        cfg.builtin.plan = migrateSubAgentItem(builtin.plan, cfg.builtin.plan)
        cfg.builtin.general = migrateSubAgentItem(
            builtin.general,
            cfg.builtin.general
        )
        cfg.builtin.explore = migrateSubAgentItem(
            builtin.explore,
            cfg.builtin.explore
        )
    }

    const presetAgents = asObject(raw.presetAgents)
    if (presetAgents) {
        cfg.presetAgents = Object.fromEntries(
            Object.entries(presetAgents).map(([name, value]) => [
                name,
                migrateSubAgentItem(
                    value,
                    createSubAgentItemConfig({
                        name,
                        source: 'preset',
                        format: 'chatluna',
                        promptMode: 'preset'
                    })
                )
            ])
        )
    }

    const defaults = asObject(raw.defaults)
    if (defaults) {
        cfg.defaults = {
            skills: migrateRule(defaults.skills, cfg.defaults.skills),
            mcp: migrateRule(defaults.mcp, cfg.defaults.mcp),
            tools: migrateRule(defaults.tools, cfg.defaults.tools),
            computer: migrateRule(defaults.computer, cfg.defaults.computer)
        }
    }

    return cfg
}

function migrateSkillsConfig(old?: OldConfig['skills']): AgentConfig['skills'] {
    const cfg = getDefaultConfig().skills
    if (!old || typeof old !== 'object') {
        return cfg
    }

    if ('allowComputerUsePrompt' in old) {
        cfg.allowComputerUsePrompt = old['allowComputerUsePrompt'] === true
    }

    if ('dirs' in old && Array.isArray(old['dirs'])) {
        cfg.dirs = old['dirs']
            .map((item) => {
                const dir = String(item).trim()
                if (dir === '.config/opencode/skills') {
                    return '~/.config/opencode/skills'
                }

                return dir
            })
            .filter(
                (item, idx, list) =>
                    item.length > 0 && list.indexOf(item) === idx
            )
    }

    const items =
        'items' in old &&
        old['items'] != null &&
        typeof old['items'] === 'object'
            ? (old['items'] as Record<string, unknown>)
            : Object.fromEntries(
                  Object.entries(old).filter(
                      ([key]) =>
                          key !== 'allowComputerUsePrompt' && key !== 'dirs'
                  )
              )

    cfg.items = Object.fromEntries(
        Object.entries(items).map(([id, value]) => {
            if (typeof value === 'boolean') {
                return [id, { enabled: value }]
            }

            if (typeof value === 'object' && value != null) {
                const item = value as Record<string, unknown>
                return [id, { enabled: item.enabled !== false }]
            }

            return [id, { enabled: true }]
        })
    )

    return cfg
}

export function migrateFromOldConfig(old?: OldConfig): AgentConfig {
    const cfg = getDefaultConfig()
    if (!old) return cfg

    cfg.version = 2
    cfg.skills = migrateSkillsConfig(old.skills)
    cfg.computer = old.computer ?? old.scheduler ?? {}
    cfg.subAgent = migrateSubAgentConfig(old.subAgent)
    cfg.tool = old.tool ?? {}

    if (!old.mcp) return cfg

    if (old.mcp.mcpServers) {
        cfg.mcp.mcpServers = Object.fromEntries(
            Object.entries(old.mcp.mcpServers).map(([name, srv]) => [
                name,
                { ...srv, env: srv.env ?? srv.environment }
            ])
        )
    }

    if (old.mcp.servers) {
        try {
            const parsed = JSON.parse(old.mcp.servers)
            if (parsed.mcpServers) {
                cfg.mcp.mcpServers = Object.fromEntries(
                    Object.entries(parsed.mcpServers).map(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ([name, srv]: [string, any]) => [
                            name,
                            { ...srv, env: srv.env ?? srv.environment }
                        ]
                    )
                )
            }
        } catch {}
    }

    if (old.mcp.tools) {
        cfg.mcp.tools = old.mcp.tools as AgentConfig['mcp']['tools']
    }

    return cfg
}
