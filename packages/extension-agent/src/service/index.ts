import { Context, Service } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { migrateFromOldConfig } from '../config/migrate'
import { readConfig } from '../config/read'
import { writeConfig } from '../config/write'
import { AgentConfig, McpToolConfig, SaveMcpServerInput } from '../types'
import { ChatLunaAgentMcpService } from './mcp'
import { ChatLunaAgentSubAgentService } from './sub_agent'

export class ChatLunaAgentService extends Service {
    public mcp: ChatLunaAgentMcpService
    public subAgent: ChatLunaAgentSubAgentService

    constructor(
        public ctx: Context,
        public args: { config: AgentConfig; plugin: ChatLunaPlugin }
    ) {
        super(ctx, 'chatluna_agent')
        const { config, plugin } = args

        this.mcp = new ChatLunaAgentMcpService(ctx, config, plugin)
        this.subAgent = new ChatLunaAgentSubAgentService(ctx, config)
    }

    async start() {
        await this.mcp.start()
    }

    async stop() {
        await this.mcp.stop()
    }

    async reload(cfg?: AgentConfig) {
        const next = cfg ?? (await readConfig(this.ctx))
        this._setConfig(next)
        await this.mcp.reload()
        await this.subAgent.reload()
        await this.refreshConsoleData()
    }

    async reloadMcp(cfg?: AgentConfig) {
        const next = cfg ?? (await readConfig(this.ctx))
        const prev = this.args.config
        this._setConfig(next)

        if (JSON.stringify(prev.mcp) !== JSON.stringify(next.mcp)) {
            await this.mcp.sync(prev.mcp, next.mcp)
        } else {
            await this.mcp.reload()
        }

        await this.refreshConsoleData()
    }

    getStatus() {
        return {
            mcp: this.mcp.getStatus(),
            subAgent: this.subAgent.getStatus()
        }
    }

    getConsoleData() {
        return {
            config: this.args.config,
            status: this.getStatus()
        }
    }

    async refreshConsoleData() {
        await this.ctx.console.refresh('chatlunaAgent')
    }

    async saveConfig(cfg: AgentConfig) {
        const next = migrateFromOldConfig(structuredClone(cfg))
        await writeConfig(this.ctx, next)
        this._setConfig(next)
        this.refreshConsoleData()
        await this.reload(next)
    }

    async saveMcpConfig(mcp: AgentConfig['mcp']) {
        const next = structuredClone(this.args.config)
        next.mcp = migrateFromOldConfig({ mcp }).mcp
        await this._saveMcp(next)
    }

    async saveMcpServer(input: SaveMcpServerInput) {
        const next = structuredClone(this.args.config)

        if (input.oldName && input.oldName !== input.name) {
            delete next.mcp.mcpServers[input.oldName]
        }

        next.mcp.mcpServers[input.name] = input.config
        next.mcp = migrateFromOldConfig({ mcp: next.mcp }).mcp
        await this._saveMcp(next)
    }

    async removeMcpServer(name: string) {
        const next = structuredClone(this.args.config)
        delete next.mcp.mcpServers[name]
        await this._saveMcp(next)
    }

    async saveMcpTool(tool: McpToolConfig) {
        const next = structuredClone(this.args.config)
        next.mcp.tools[tool.name] = {
            name: tool.name,
            enabled: tool.enabled,
            timeout: tool.timeout,
            selector: tool.selector ?? []
        }
        await this._saveMcp(next)
    }

    private _setConfig(cfg: AgentConfig) {
        this.args.config = cfg
        this.mcp.config = cfg
        this.subAgent.config = cfg
    }

    private async _saveMcp(next: AgentConfig) {
        const prev = this.args.config
        const cfg = migrateFromOldConfig(structuredClone(next))

        await writeConfig(this.ctx, cfg)
        this._setConfig(cfg)
        await this.mcp.sync(prev.mcp, cfg.mcp)
        await this.refreshConsoleData()
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_agent: ChatLunaAgentService
    }
}
