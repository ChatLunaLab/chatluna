import { AgentConfig } from '../types'

export function getDefaultConfig(): AgentConfig {
    return {
        version: 1,
        mcp: {
            mcpServers: {},
            tools: {}
        },
        skills: {},
        scheduler: {},
        tool: {},
        subAgent: {}
    }
}
