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
            dirs: [
                '~/.agents/skills',
                '~/.codex/skills',
                '~/.claude/skills',
                '~/.config/opencode/skills'
            ],
            items: {}
        },
        computer: {},
        subAgent: {},
        tool: {}
    }
}
