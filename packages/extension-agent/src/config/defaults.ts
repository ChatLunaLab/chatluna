import { AgentConfig } from '../types'

export function getDefaultConfig(): AgentConfig {
    return {
        version: 1,
        mcp: {
            mcpServers: {},
            tools: {}
        },
        skills: {
            allowComputerUsePrompt: false,
            items: {}
        },
        scheduler: {},
        tool: {},
        subAgent: {}
    }
}
