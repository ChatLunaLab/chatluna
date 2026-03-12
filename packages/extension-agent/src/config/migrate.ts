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
    skills?: Record<string, unknown>
    scheduler?: Record<string, unknown>
    tool?: Record<string, unknown>
    subAgent?: Record<string, unknown>
}

export function migrateFromOldConfig(old?: OldConfig): AgentConfig {
    const cfg = getDefaultConfig()
    if (!old) return cfg

    cfg.version = old.version ?? 1
    cfg.skills = old.skills ?? {}
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
