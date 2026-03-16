import { DataService } from '@koishijs/plugin-console'
import { Context } from 'koishi'
import { listModelNames } from 'koishi-plugin-chatluna/utils/schema'
import { resolve } from 'path'
import { getSkillsRootPath } from '../config/path'
import { readConfig } from '../config/read'
import { AgentConsoleData, McpServerConfig } from '../types'

class ChatLunaAgentConsoleService extends DataService<AgentConsoleData> {
    constructor(ctx: Context) {
        super(ctx, 'chatluna_agent_webui')
    }

    async get() {
        if (this.ctx.chatluna_agent) {
            return this.ctx.chatluna_agent.getConsoleData()
        }

        return {
            config: await readConfig(this.ctx),
            status: {
                mcp: { connected: false, servers: {}, tools: {} },
                skills: {
                    enabled: true,
                    root: getSkillsRootPath(this.ctx),
                    total: 0,
                    visible: 0,
                    modelEnabled: 0,
                    activeConversations: 0,
                    catalog: {}
                },
                subAgent: {
                    enabled: false,
                    total: 0,
                    catalog: {},
                    runs: []
                },
                tool: {
                    enabled: false,
                    total: 0,
                    mainEnabled: 0,
                    subAgentEnabled: 0,
                    catalog: {}
                }
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

    ctx.console.addListener('chatluna-agent/getSkills', async () =>
        agent().skills.listSkills()
    )

    ctx.console.addListener('chatluna-agent/getSubAgents', async () =>
        agent().subAgent.getCatalogSync()
    )

    ctx.console.addListener('chatluna-agent/getSubAgentRuns', async () =>
        agent().subAgent.getRuns()
    )

    ctx.console.addListener(
        'chatluna-agent/getModelNames',
        async () => listModelNames(ctx.chatluna.platform).value
    )

    ctx.console.addListener('chatluna-agent/getSkillContent', async (id) =>
        agent().skills.getSkillContent(id)
    )

    ctx.console.addListener('chatluna-agent/exportSkill', async (id) =>
        agent().exportSkill(id)
    )

    ctx.console.addListener('chatluna-agent/importSkills', async (input) => {
        const result = await agent().skills.importSkills(input)
        await agent().refreshConsoleData()
        return result
    })

    ctx.console.addListener(
        'chatluna-agent/saveMcp',
        ok((cfg) => agent().saveMcpConfig(cfg))
    )

    ctx.console.addListener(
        'chatluna-agent/saveSkills',
        ok((cfg) => agent().saveSkillsConfig(cfg))
    )

    ctx.console.addListener(
        'chatluna-agent/saveSubAgentConfig',
        ok((cfg) => agent().saveSubAgentConfig(cfg))
    )

    ctx.console.addListener(
        'chatluna-agent/reloadSkills',
        ok(async () => {
            await agent().skills.reload()
            await agent().refreshConsoleData()
        })
    )

    ctx.console.addListener(
        'chatluna-agent/reloadSubAgents',
        ok(async () => {
            await agent().reloadSubAgents()
        })
    )

    ctx.console.addListener(
        'chatluna-agent/removeSkill',
        ok((id: string) => agent().removeSkill(id))
    )

    ctx.console.addListener(
        'chatluna-agent/setSkillEnabled',
        ok((id: string, enabled: boolean) =>
            agent().setSkillEnabled(id, enabled)
        )
    )

    ctx.console.addListener(
        'chatluna-agent/setSubAgentEnabled',
        ok((id: string, enabled: boolean) =>
            agent().setSubAgentEnabled(id, enabled)
        )
    )

    ctx.console.addListener(
        'chatluna-agent/uploadSubAgent',
        ok((input) => agent().uploadSubAgent(input))
    )

    ctx.console.addListener(
        'chatluna-agent/createPresetAgent',
        ok((name: string, preset: string, config) =>
            agent().createPresetAgent(name, preset, config)
        )
    )

    ctx.console.addListener(
        'chatluna-agent/removeSubAgent',
        ok((id: string) => agent().removeSubAgent(id))
    )

    ctx.console.addListener('chatluna-agent/getToolAvailability', async () =>
        agent().getToolAvailability()
    )

    ctx.console.addListener('chatluna-agent/getPresetNames', async () =>
        agent().getPresetNames()
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
