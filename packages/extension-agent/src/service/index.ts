import { mkdir, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { Context, Service } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createSubAgentItemConfig } from '../config/defaults'
import { migrateFromOldConfig } from '../config/migrate'
import { getSubAgentsRootPath } from '../config/path'
import { readConfig } from '../config/read'
import { writeConfig } from '../config/write'
import {
    AgentConfig,
    McpToolConfig,
    SaveMcpServerInput,
    SkillExportResult,
    SubAgentConfig,
    SubAgentImportInput,
    SubAgentItemConfig
} from '../types'
import { ChatLunaAgentMcpService } from './mcp'
import { ChatLunaAgentPermissionService } from './permissions'
import { ChatLunaAgentSkillsService } from './skills'
import { ChatLunaAgentSubAgentService } from './sub_agent'

export class ChatLunaAgentService extends Service {
    public mcp: ChatLunaAgentMcpService
    public permission: ChatLunaAgentPermissionService
    public skills: ChatLunaAgentSkillsService
    public subAgent: ChatLunaAgentSubAgentService

    constructor(
        public ctx: Context,
        public args: { config: AgentConfig; plugin: ChatLunaPlugin }
    ) {
        super(ctx, 'chatluna_agent')
        const { config, plugin } = args

        this.permission = new ChatLunaAgentPermissionService(ctx, config)
        this.mcp = new ChatLunaAgentMcpService(ctx, config, plugin)
        this.skills = new ChatLunaAgentSkillsService(
            ctx,
            config,
            this.permission
        )
        this.subAgent = new ChatLunaAgentSubAgentService(
            ctx,
            config,
            this.permission
        )
    }

    async start() {
        await this.permission.start()
        await this.skills.start()
        await this.mcp.start()
        await this.subAgent.start()
    }

    async stop() {
        await this.permission.stop()
        await this.skills.stop()
        await this.mcp.stop()
        await this.subAgent.stop()
    }

    async reload(cfg?: AgentConfig) {
        const next = cfg ?? (await readConfig(this.ctx))
        this._setConfig(next)
        await this.skills.reload()
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
            skills: this.skills.getStatus(),
            subAgent: this.subAgent.getStatus(),
            tool: this.permission.getStatus()
        }
    }

    getConsoleData() {
        return {
            config: this.args.config,
            status: this.getStatus()
        }
    }

    async refreshConsoleData() {
        await this.ctx.chatluna_agent_webui?.refresh(true)
    }

    async saveConfig(cfg: AgentConfig) {
        const next = migrateFromOldConfig(structuredClone(cfg))
        await writeConfig(this.ctx, next)
        this._setConfig(next)
        await this.refreshConsoleData()
        await this.reload(next)
    }

    async saveMcpConfig(mcp: AgentConfig['mcp']) {
        const next = structuredClone(this.args.config)
        next.mcp = migrateFromOldConfig({ mcp }).mcp
        await this._saveMcp(next)
    }

    async saveSkillsConfig(skills: AgentConfig['skills']) {
        const next = structuredClone(this.args.config)
        next.skills = migrateFromOldConfig({ skills }).skills
        await this._saveSkills(next)
    }

    async saveSubAgentConfig(subAgent: SubAgentConfig) {
        const next = structuredClone(this.args.config)
        next.subAgent = migrateFromOldConfig({ subAgent }).subAgent
        await this._saveSubAgent(next)
    }

    async exportSkill(id: string): Promise<SkillExportResult | undefined> {
        return await this.skills.exportSkill(id)
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

    async setSkillEnabled(id: string, enabled: boolean) {
        const next = structuredClone(this.args.config)
        next.skills.items[id] = { enabled }
        await this._saveSkills(next)
    }

    async removeSkill(id: string) {
        await this.skills.removeSkill(id)

        const next = structuredClone(this.args.config)
        delete next.skills.items[id]
        await this._saveSkills(next)
    }

    async setSubAgentEnabled(id: string, enabled: boolean) {
        const next = structuredClone(this.args.config)
        const info = this.subAgent
            .getCatalogSync()
            .find((item) => item.id === id)
        if (!info) {
            throw new Error(`Sub-agent not found: ${id}`)
        }

        if (info.source === 'builtin') {
            next.subAgent.builtin[info.name] = itemFromInfo(info, enabled)
        } else if (info.source === 'preset') {
            next.subAgent.presetAgents[info.name] = itemFromInfo(info, enabled)
        } else {
            next.subAgent.items[id] = itemFromInfo(info, enabled)
        }

        await this._saveSubAgent(next)
    }

    async uploadSubAgent(input: SubAgentImportInput) {
        const name = input.name.replace(/\.md$/i, '').trim()
        if (!name) {
            throw new Error('Sub-agent file name is empty')
        }

        const root = getSubAgentsRootPath(this.ctx)
        const file = join(root, name, 'index.md')
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, input.data, 'utf-8')
        await this.subAgent.reload()
        await this.refreshConsoleData()
    }

    async createPresetAgent(
        name: string,
        preset: string,
        config: Partial<SubAgentItemConfig>
    ) {
        const next = structuredClone(this.args.config)
        next.subAgent.presetAgents[name] = createSubAgentItemConfig({
            enabled: config.enabled ?? true,
            name,
            description: config.description ?? name,
            source: 'preset',
            format: 'chatluna',
            model: config.model,
            maxTurns: config.maxTurns,
            hidden: config.hidden,
            promptMode: 'preset',
            preset,
            allowKoishiMessageTransform:
                config.allowKoishiMessageTransform ?? false,
            permissions: config.permissions ?? next.subAgent.defaults
        })
        await this._saveSubAgent(next)
    }

    async removeSubAgent(id: string) {
        const info = this.subAgent
            .getCatalogSync()
            .find((item) => item.id === id)
        if (!info) {
            throw new Error(`Sub-agent not found: ${id}`)
        }

        if (info.source === 'preset') {
            const next = structuredClone(this.args.config)
            delete next.subAgent.presetAgents[info.name]
            await this._saveSubAgent(next)
            return
        }

        if (info.source === 'markdown') {
            if (!info.path) {
                throw new Error('Sub-agent path is missing')
            }

            const root = resolve(getSubAgentsRootPath(this.ctx))
            const file = resolve(info.path)
            if (!file.startsWith(root)) {
                throw new Error(
                    'Only sub-agents inside data/chatluna/agents can be removed here'
                )
            }

            const dir = dirname(file)
            const dirStat = await stat(dir).catch(() => undefined)
            if (dirStat?.isDirectory()) {
                await rm(dir, { recursive: true, force: true })
            } else {
                await rm(file, { force: true })
            }

            const next = structuredClone(this.args.config)
            delete next.subAgent.items[id]
            await this._saveSubAgent(next)
            return
        }

        throw new Error('Builtin sub-agents cannot be removed')
    }

    async reloadSubAgents() {
        await this.subAgent.reload()
        await this.refreshConsoleData()
    }

    async getToolAvailability() {
        return this.permission.getToolAvailability()
    }

    async getPresetNames() {
        return this.ctx.chatluna.preset.getAllPreset(false).value
    }

    private _setConfig(cfg: AgentConfig) {
        this.args.config = cfg
        this.permission.config = cfg
        this.mcp.config = cfg
        this.skills.config = cfg
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

    private async _saveSkills(next: AgentConfig) {
        const cfg = migrateFromOldConfig(structuredClone(next))
        await writeConfig(this.ctx, cfg)
        this._setConfig(cfg)
        await this.skills.reload()
        await this.refreshConsoleData()
    }

    private async _saveSubAgent(next: AgentConfig) {
        const cfg = migrateFromOldConfig(structuredClone(next))
        await writeConfig(this.ctx, cfg)
        this._setConfig(cfg)
        await this.subAgent.reload()
        await this.refreshConsoleData()
    }
}

function itemFromInfo(info, enabled: boolean) {
    return createSubAgentItemConfig({
        enabled,
        name: info.name,
        description: info.description,
        source: info.source,
        format: info.format,
        model: info.model,
        maxTurns: info.maxTurns,
        hidden: info.hidden,
        promptMode: info.promptMode,
        preset: info.preset,
        allowKoishiMessageTransform: info.allowKoishiMessageTransform,
        permissions: info.permissions
    })
}

declare module 'koishi' {
    interface Context {
        chatluna_agent: ChatLunaAgentService
    }
}
