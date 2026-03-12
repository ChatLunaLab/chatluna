import { DataService } from '@koishijs/plugin-console'
import { Context } from 'koishi'
import { resolve } from 'path'
import { readConfig } from '../config/read'
import { AgentConsoleData, McpServerConfig } from '../types'

class ChatLunaAgentConsoleService extends DataService<AgentConsoleData> {
    constructor(ctx: Context) {
        super(ctx, 'chatlunaAgent')
    }

    async get() {
        if (this.ctx.chatluna_agent) {
            return this.ctx.chatluna_agent.getConsoleData()
        }

        return {
            config: await readConfig(this.ctx),
            status: {
                mcp: { connected: false, servers: {}, tools: {} },
                subAgent: { enabled: false, agents: {} }
            }
        }
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok<T>(fn: (...args: any[]) => Promise<T>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (...args: any[]) => {
        await fn(...args)
        return { success: true }
    }
}

export function apply(ctx: Context) {
    ctx.plugin(ChatLunaAgentConsoleService)

    ctx.console.addEntry({
        dev: resolve(__dirname, '../client/index.ts'),
        prod: resolve(__dirname, '../dist')
    })

    const agent = () => ctx.chatluna_agent

    ctx.console.addListener(
        'chatluna-agent/getConfig',
        async () => agent().getConsoleData().config
    )

    ctx.console.addListener(
        'chatluna-agent/saveConfig',
        ok((cfg) => agent().saveConfig(cfg))
    )

    ctx.console.addListener('chatluna-agent/getStatus', async () =>
        agent().getStatus()
    )

    ctx.console.addListener('chatluna-agent/getMcpStatus', async () =>
        agent().mcp.getStatus()
    )

    ctx.console.addListener(
        'chatluna-agent/saveMcp',
        ok((cfg) => agent().saveMcpConfig(cfg))
    )

    ctx.console.addListener(
        'chatluna-agent/upsertMcpServer',
        ok((name: string, cfg: McpServerConfig) =>
            agent().saveMcpServer({ name, config: cfg })
        )
    )

    ctx.console.addListener(
        'chatluna-agent/saveMcpServer',
        ok((input) => agent().saveMcpServer(input))
    )

    ctx.console.addListener(
        'chatluna-agent/removeMcpServer',
        ok((name) => agent().removeMcpServer(name))
    )

    ctx.console.addListener(
        'chatluna-agent/toggleMcpTool',
        ok((name: string, enabled: boolean) => {
            const tool = agent().getConsoleData().config.mcp.tools[name]
            return agent().saveMcpTool({
                name,
                enabled,
                timeout: tool?.timeout,
                selector: tool?.selector ?? []
            })
        })
    )

    ctx.console.addListener(
        'chatluna-agent/saveMcpTool',
        ok((tool) => agent().saveMcpTool(tool))
    )

    ctx.console.addListener(
        'chatluna-agent/reloadMcp',
        ok(() => agent().reloadMcp())
    )

    ctx.console.addListener(
        'chatluna-agent/reconnectMcpServer',
        ok((name) => agent().mcp.reconnect(name))
    )

    ctx.console.addListener(
        'chatluna-agent/refreshConsoleData',
        ok(() => agent().refreshConsoleData())
    )
}
