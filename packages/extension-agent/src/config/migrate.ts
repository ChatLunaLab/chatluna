/** @module config/migrate */

import {
    AgentConfig,
    ComputerConfig,
    McpServerConfig,
    PermissionRule,
    SubAgentConfig,
    SubAgentItemConfig
} from '../types'
import {
    createDefaultComputerConfig,
    createDefaultSubAgentConfig,
    createDefaultToolConfig,
    createPermissionRule,
    createSubAgentItemConfig,
    createToolItemConfig,
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
    computer?: Record<string, unknown> | AgentConfig['computer']
    scheduler?: Record<string, unknown> | AgentConfig['computer']
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

function readBool(
    obj: Record<string, unknown>,
    key: string,
    fallback: boolean
): boolean {
    return typeof obj[key] === 'boolean' ? obj[key] : fallback
}

function readString(
    obj: Record<string, unknown>,
    key: string,
    fallback: string
): string {
    return typeof obj[key] === 'string' ? obj[key] : fallback
}

function readNumber(
    obj: Record<string, unknown>,
    key: string,
    fallback: number
): number {
    return typeof obj[key] === 'number' ? obj[key] : fallback
}

function readEnum<T extends string>(
    obj: Record<string, unknown>,
    key: string,
    allowed: T[],
    fallback: T
): T {
    const value = obj[key]
    return typeof value === 'string' && allowed.includes(value as T)
        ? (value as T)
        : fallback
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
                  Object.entries(old).filter(([key]) => key !== 'dirs')
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

function migrateToolConfig(old?: OldConfig['tool']): AgentConfig['tool'] {
    const cfg = createDefaultToolConfig()
    const raw = asObject(old)
    if (!raw) {
        return cfg
    }

    const items = asObject(raw.items)
    if (items) {
        cfg.items = Object.fromEntries(
            Object.entries(items).map(([name, value]) => {
                const item = asObject(value)
                return [
                    name,
                    createToolItemConfig({
                        enabled: item?.enabled !== false,
                        main: item?.main !== false,
                        subAgents: migrateRule(
                            item?.subAgents,
                            createPermissionRule('all')
                        )
                    })
                ]
            })
        )
    }

    const registry = asObject(raw.registry)
    if (registry) {
        cfg.registry = Object.fromEntries(
            Object.entries(registry).map(([name, value]) => {
                const item = asObject(value)
                return [
                    name,
                    {
                        source:
                            typeof item?.source === 'string'
                                ? item.source
                                : undefined,
                        group:
                            typeof item?.group === 'string'
                                ? item.group
                                : undefined,
                        tags: readNames(item?.tags)
                    }
                ]
            })
        )
    }

    return cfg
}

function migrateComputerConfig(old?: OldConfig['computer']): ComputerConfig {
    const cfg = createDefaultComputerConfig()
    const raw = asObject(old)
    if (!raw) {
        return cfg
    }

    cfg.defaultProvider = readEnum(
        raw,
        'defaultProvider',
        ['local', 'e2b', 'open-terminal'],
        cfg.defaultProvider
    )
    cfg.idleTimeoutMs = readNumber(raw, 'idleTimeoutMs', cfg.idleTimeoutMs)

    const local = asObject(raw.local)
    if (local) {
        cfg.local.enabled = readBool(local, 'enabled', cfg.local.enabled)
        cfg.local.sandboxMode = readEnum(
            local,
            'sandboxMode',
            ['read-only', 'workspace-write'],
            cfg.local.sandboxMode
        )
        cfg.local.approvalMode = readEnum(
            local,
            'approvalMode',
            ['on-request', 'never'],
            cfg.local.approvalMode
        )
        cfg.local.dangerouslySkipPermissions = readBool(
            local,
            'dangerouslySkipPermissions',
            cfg.local.dangerouslySkipPermissions
        )
        cfg.local.preferredShell = readEnum(
            local,
            'preferredShell',
            ['git-bash', 'powershell', 'cmd', 'auto'],
            cfg.local.preferredShell
        )
        cfg.local.scopePath = readString(
            local,
            'scopePath',
            cfg.local.scopePath
        )
        cfg.local.writableRoots = readNames(local.writableRoots)
        cfg.local.readOnlyRoots = readNames(local.readOnlyRoots)
        cfg.local.denyRoots = readNames(local.denyRoots)
        cfg.local.ignores = readNames(local.ignores)
        cfg.local.allowedCommands = readNames(local.allowedCommands)
        cfg.local.blockedCommands = readNames(local.blockedCommands)
        cfg.local.commandTimeoutMs = readNumber(
            local,
            'commandTimeoutMs',
            cfg.local.commandTimeoutMs
        )
        cfg.local.networkPolicy = readEnum(
            local,
            'networkPolicy',
            ['block', 'allow'],
            cfg.local.networkPolicy
        )
    }

    // v0-v3 兼容：旧版把 local 字段直接平铺在 computer/scheduler 下。
    if (typeof raw.enabled === 'boolean') {
        cfg.local.enabled = raw.enabled
    }
    if (typeof raw.scopePath === 'string') {
        cfg.local.scopePath = raw.scopePath
    }
    if (readNames(raw.writableRoots).length > 0) {
        cfg.local.writableRoots = readNames(raw.writableRoots)
    }
    if (readNames(raw.readOnlyRoots).length > 0) {
        cfg.local.readOnlyRoots = readNames(raw.readOnlyRoots)
    }
    if (readNames(raw.denyRoots).length > 0) {
        cfg.local.denyRoots = readNames(raw.denyRoots)
    }
    if (readNames(raw.ignores).length > 0) {
        cfg.local.ignores = readNames(raw.ignores)
    }
    if (readNames(raw.fsIgnores).length > 0) {
        cfg.local.ignores = readNames(raw.fsIgnores)
    }
    if (readNames(raw.allowedCommands).length > 0) {
        cfg.local.allowedCommands = readNames(raw.allowedCommands)
    }
    if (readNames(raw.bashAllowedCommands).length > 0) {
        cfg.local.allowedCommands = readNames(raw.bashAllowedCommands)
    }
    if (readNames(raw.blockedCommands).length > 0) {
        cfg.local.blockedCommands = readNames(raw.blockedCommands)
    }
    if (readNames(raw.bashBlockedCommands).length > 0) {
        cfg.local.blockedCommands = readNames(raw.bashBlockedCommands)
    }
    if (typeof raw.commandTimeoutMs === 'number') {
        cfg.local.commandTimeoutMs = raw.commandTimeoutMs
    }
    // v0-v3 兼容：bashTimeout 旧字段已迁移到 commandTimeoutMs。
    if (typeof raw.bashTimeout === 'number') {
        cfg.local.commandTimeoutMs = raw.bashTimeout
    }
    if (
        raw.sandboxMode === 'read-only' ||
        raw.sandboxMode === 'workspace-write'
    ) {
        cfg.local.sandboxMode = raw.sandboxMode
    }
    if (raw.approvalMode === 'on-request' || raw.approvalMode === 'never') {
        cfg.local.approvalMode = raw.approvalMode
    }
    // v0-v3 兼容：bashAutoExecute=true 等价于 approvalMode='never'。
    if (typeof raw.bashAutoExecute === 'boolean' && raw.bashAutoExecute) {
        cfg.local.approvalMode = 'never'
    }
    if (typeof raw.dangerouslySkipPermissions === 'boolean') {
        cfg.local.dangerouslySkipPermissions = raw.dangerouslySkipPermissions
    }
    if (
        raw.preferredShell === 'git-bash' ||
        raw.preferredShell === 'powershell' ||
        raw.preferredShell === 'cmd' ||
        raw.preferredShell === 'auto'
    ) {
        cfg.local.preferredShell = raw.preferredShell
    }
    if (raw.networkPolicy === 'block' || raw.networkPolicy === 'allow') {
        cfg.local.networkPolicy = raw.networkPolicy
    }

    const e2b = asObject(raw.e2b)
    if (e2b) {
        cfg.e2b.enabled = readBool(e2b, 'enabled', cfg.e2b.enabled)
        cfg.e2b.apiKey = readString(e2b, 'apiKey', cfg.e2b.apiKey)
        cfg.e2b.template = readString(e2b, 'template', cfg.e2b.template)
        cfg.e2b.desktopTemplate = readString(
            e2b,
            'desktopTemplate',
            cfg.e2b.desktopTemplate
        )
        cfg.e2b.timeoutMs = readNumber(e2b, 'timeoutMs', cfg.e2b.timeoutMs)
        cfg.e2b.keepAlive = readBool(e2b, 'keepAlive', cfg.e2b.keepAlive)
    }

    const openTerminal = asObject(raw.openTerminal ?? raw.open_terminal)
    if (openTerminal) {
        cfg.openTerminal.enabled = readBool(
            openTerminal,
            'enabled',
            cfg.openTerminal.enabled
        )
        cfg.openTerminal.baseUrl = readString(
            openTerminal,
            'baseUrl',
            cfg.openTerminal.baseUrl
        )
        cfg.openTerminal.apiKey = readString(
            openTerminal,
            'apiKey',
            cfg.openTerminal.apiKey
        )
        cfg.openTerminal.deploymentMode = readEnum(
            openTerminal,
            'deploymentMode',
            ['docker', 'bare-metal', 'unknown'],
            cfg.openTerminal.deploymentMode
        )
        cfg.openTerminal.userIsolation = readBool(
            openTerminal,
            'userIsolation',
            cfg.openTerminal.userIsolation
        )
    }

    return cfg
}

export function migrateFromOldConfig(old?: OldConfig): AgentConfig {
    const cfg = getDefaultConfig()
    if (!old) return cfg

    cfg.version = 4
    cfg.skills = migrateSkillsConfig(old.skills)
    cfg.computer = migrateComputerConfig(old.computer ?? old.scheduler)
    cfg.subAgent = migrateSubAgentConfig(old.subAgent)
    cfg.tool = migrateToolConfig(old.tool)

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
                    Object.entries(parsed.mcpServers).map(([name, srv]) => {
                        const item = srv as McpServerConfig & {
                            environment?: Record<string, string>
                        }
                        return [
                            name,
                            {
                                ...item,
                                env: item.env ?? item.environment
                            }
                        ]
                    })
                )
            }
        } catch {}
    }

    if (old.mcp.tools) {
        cfg.mcp.tools = old.mcp.tools as AgentConfig['mcp']['tools']
    }

    return cfg
}
