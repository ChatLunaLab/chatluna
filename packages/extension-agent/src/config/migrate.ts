import { AgentConfig, McpServerConfig } from '../types'
import { getDefaultConfig } from './defaults'

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
    scheduler?: Record<string, unknown>
    tool?: Record<string, unknown>
    subAgent?: Record<string, unknown>
}

function migrateSkillsConfig(old?: OldConfig['skills']): AgentConfig['skills'] {
    const cfg = getDefaultConfig().skills
    if (!old || typeof old !== 'object') {
        return cfg
    }

    if ('allowComputerUsePrompt' in old) {
        cfg.allowComputerUsePrompt = old['allowComputerUsePrompt'] === true
    }

    const items =
        'items' in old &&
        old['items'] != null &&
        typeof old['items'] === 'object'
            ? (old['items'] as Record<string, unknown>)
            : Object.fromEntries(
                  Object.entries(old).filter(
                      ([key]) => key !== 'allowComputerUsePrompt'
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

    cfg.version = old.version ?? 1
    cfg.skills = migrateSkillsConfig(old.skills)
    cfg.scheduler = old.scheduler ?? {}
    cfg.tool = old.tool ?? {}
    cfg.subAgent = old.subAgent ?? {}

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
