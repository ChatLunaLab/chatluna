/** @module service/index */

import { mkdir, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { Context, Service } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { ChatLunaAgentCliService } from '../cli/service'
import { createSubAgentItemConfig } from '../config/defaults'
import { getSkillsRootPath, getSubAgentsRootPath } from '../config/path'
import { readConfig } from '../config/read'
import { writeConfig } from '../config/write'
import {
    createSubAgentMarkdown,
    getSubAgentFileName
} from '../sub-agent/markdown'
import {
    AgentConfig,
    ManualSubAgentInput,
    McpToolConfig,
    SaveMcpServerInput,
    SkillExportResult,
    SkillImportInput,
    SkillImportPreviewResult,
    SkillImportResult,
    SubAgentConfig,
    SubAgentImportInput,
    SubAgentInfo,
    SubAgentItemConfig
} from '../types'
import { createHashId } from '../utils/id'
import { ChatLunaAgentComputerService } from './computer'
import { ChatLunaAgentMcpService } from './mcp'
import { ChatLunaAgentPermissionService } from './permissions'
import { ChatLunaAgentSkillsService } from './skills'
import { ChatLunaAgentSubAgentService } from './sub_agent'

export class ChatLunaAgentService extends Service {
    public cli: ChatLunaAgentCliService
    public computer: ChatLunaAgentComputerService
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
        this.cli = new ChatLunaAgentCliService(ctx, () => this)
        this.computer = new ChatLunaAgentComputerService(ctx, config)
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
        await Promise.all([
            this.permission.start(),
            this.cli.start(),
            this.computer.start(),
            this.skills.start(),
            this.subAgent.start(),
            this.mcp.start()
        ])
        this.ctx.setTimeout(() => this.refreshConsoleData(), 20)
    }

    async stop() {
        await this.subAgent.stop()
        await this.mcp.stop()
        await this.skills.stop()
        await this.computer.stop()
        await this.cli.stop()
        await this.permission.stop()
    }

    async reload(cfg?: AgentConfig) {
        const next = cfg ?? (await readConfig(this.ctx))
        this._setConfig(next)
        await this.computer.reload()
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
            computer: this.computer.getStatus(),
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
        await this.ctx.console.services.chatluna_agent_webui?.refresh(true)
    }

    async saveConfig(cfg: AgentConfig) {
        const next = cfg
        await writeConfig(this.ctx, next)
        this._setConfig(next)
        await this.reload(next)
    }

    async saveMcpConfig(mcp: AgentConfig['mcp']) {
        const prev = this.args.config.mcp
        await this.updateConfig('mcp', mcp, async (cfg) => {
            await this.mcp.sync(prev, cfg.mcp)
        })
    }

    async saveSkillsConfig(skills: AgentConfig['skills']) {
        await this.updateConfig('skills', skills, async () => {
            await this.skills.reload()
        })
    }

    async saveComputerConfig(computer: AgentConfig['computer']) {
        await this.updateConfig('computer', computer, async () => {
            await this.computer.reload()
            await this.skills.reload()
        })
    }

    async saveToolConfig(tool: AgentConfig['tool']) {
        await this.updateConfig('tool', tool)
    }

    async saveSubAgentConfig(subAgent: SubAgentConfig) {
        await this.updateConfig('subAgent', subAgent, async () => {
            await this.subAgent.reload()
        })
    }

    async exportSkill(id: string): Promise<SkillExportResult | undefined> {
        return await this.skills.exportSkill(id)
    }

    async previewSkillImport(
        input: SkillImportInput
    ): Promise<SkillImportPreviewResult> {
        return await this.skills.previewImport(input)
    }

    async importSkills(input: SkillImportInput): Promise<SkillImportResult> {
        const result = await this.skills.importSkills(input)
        const skills = {
            dirs: [...this.args.config.skills.dirs],
            items: { ...this.args.config.skills.items }
        }

        for (const name of result.imported) {
            skills.items[
                createHashId(
                    join(getSkillsRootPath(this.ctx), name, 'SKILL.md')
                )
            ] = { enabled: true }
        }

        await this.updateConfig('skills', skills, async () => {
            await this.skills.reload()
        })

        return result
    }

    async saveMcpServer(input: SaveMcpServerInput) {
        const prev = this.args.config.mcp
        const mcp = {
            mcpServers: { ...this.args.config.mcp.mcpServers },
            tools: { ...this.args.config.mcp.tools }
        }

        if (input.oldName && input.oldName !== input.name) {
            delete mcp.mcpServers[input.oldName]
        }

        mcp.mcpServers[input.name] = input.config
        await this.updateConfig('mcp', mcp, async (cfg) => {
            await this.mcp.sync(prev, cfg.mcp)
        })
    }

    async removeMcpServer(name: string) {
        const prev = this.args.config.mcp
        const mcp = {
            mcpServers: { ...this.args.config.mcp.mcpServers },
            tools: { ...this.args.config.mcp.tools }
        }
        delete mcp.mcpServers[name]
        await this.updateConfig('mcp', mcp, async (cfg) => {
            await this.mcp.sync(prev, cfg.mcp)
        })
    }

    async saveMcpTool(tool: McpToolConfig) {
        const prev = this.args.config.mcp
        const mcp = {
            mcpServers: { ...this.args.config.mcp.mcpServers },
            tools: { ...this.args.config.mcp.tools }
        }
        mcp.tools[tool.name] = {
            name: tool.name,
            enabled: tool.enabled,
            timeout: tool.timeout,
            selector: tool.selector ?? []
        }
        await this.updateConfig('mcp', mcp, async (cfg) => {
            await this.mcp.sync(prev, cfg.mcp)
        })
    }

    async setSkillEnabled(id: string, enabled: boolean) {
        const skills = {
            dirs: [...this.args.config.skills.dirs],
            items: { ...this.args.config.skills.items }
        }
        skills.items[id] = { enabled }
        await this.updateConfig('skills', skills, async () => {
            await this.skills.reload()
        })
    }

    async removeSkill(id: string) {
        await this.skills.removeSkill(id)

        const skills = {
            dirs: [...this.args.config.skills.dirs],
            items: { ...this.args.config.skills.items }
        }
        delete skills.items[id]
        await this.updateConfig('skills', skills, async () => {
            await this.skills.reload()
        })
    }

    async setSubAgentEnabled(id: string, enabled: boolean) {
        const subAgent = structuredClone(this.args.config.subAgent)
        const info = this.subAgent
            .getCatalogSync()
            .find((item) => item.id === id)
        if (!info) {
            throw new Error(`Sub-agent not found: ${id}`)
        }

        if (info.source === 'builtin') {
            subAgent.builtin[info.name] = itemFromInfo(info, enabled)
        } else if (info.source === 'preset') {
            subAgent.presetAgents[info.name] = itemFromInfo(info, enabled)
        } else if (info.source === 'manual') {
            await this.subAgent.setManualAgentEnabled(id, enabled)
            return
        } else {
            subAgent.items[id] = itemFromInfo(info, enabled)
        }

        await this.updateConfig('subAgent', subAgent, async () => {
            await this.subAgent.reload()
        })
    }

    async uploadSubAgent(input: SubAgentImportInput) {
        const root = getSubAgentsRootPath(this.ctx)
        const file = join(root, getSubAgentFileName(input.name), 'index.md')
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, input.data, 'utf-8')
        await this.subAgent.reload()
        await this.refreshConsoleData()
    }

    async addSubAgent(input: ManualSubAgentInput) {
        const root = getSubAgentsRootPath(this.ctx)
        const file = join(root, getSubAgentFileName(input.name), 'index.md')
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, createSubAgentMarkdown(input), 'utf-8')
        await this.subAgent.reload()
        await this.refreshConsoleData()

        const path = resolve(file)
        const info = this.subAgent
            .getCatalogSync()
            .find((item) => item.path && resolve(item.path) === path)

        if (!info) {
            throw new Error(
                `Sub-agent was created but not found: ${input.name}`
            )
        }

        return info
    }

    async registerSubAgent(input: ManualSubAgentInput) {
        return await this.subAgent.registerManualAgent(input)
    }

    async createPresetAgent(
        name: string,
        preset: string,
        config: Partial<SubAgentItemConfig>
    ) {
        const subAgent = structuredClone(this.args.config.subAgent)
        subAgent.presetAgents[name] = createSubAgentItemConfig({
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
            permissions: config.permissions ?? subAgent.defaults
        })
        await this.updateConfig('subAgent', subAgent, async () => {
            await this.subAgent.reload()
        })
    }

    async removeSubAgent(id: string) {
        const info = this.subAgent
            .getCatalogSync()
            .find((item) => item.id === id)
        if (!info) {
            throw new Error(`Sub-agent not found: ${id}`)
        }

        if (info.source === 'preset') {
            const subAgent = structuredClone(this.args.config.subAgent)
            delete subAgent.presetAgents[info.name]
            await this.updateConfig('subAgent', subAgent, async () => {
                await this.subAgent.reload()
            })
            return
        }

        if (info.source === 'markdown') {
            if (!info.path) {
                throw new Error('Sub-agent path is missing')
            }

            if (info.remote) {
                await this.computer.removeRemoteSubAgent(info.path)
                const subAgent = structuredClone(this.args.config.subAgent)
                delete subAgent.items[id]
                await this.updateConfig('subAgent', subAgent, async () => {
                    await this.subAgent.reload()
                })
                return
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

            const subAgent = structuredClone(this.args.config.subAgent)
            delete subAgent.items[id]
            await this.updateConfig('subAgent', subAgent, async () => {
                await this.subAgent.reload()
            })
            return
        }

        if (info.source === 'manual') {
            await this.subAgent.removeManualAgent(id)
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
        this.permission.invalidateCache()
        this.computer.config = cfg
        this.mcp.config = cfg
        this.skills.config = cfg
        this.subAgent.config = cfg
    }

    private async updateConfig<K extends keyof AgentConfig>(
        section: K,
        patch: AgentConfig[K],
        afterSave?: (cfg: AgentConfig) => Promise<void>
    ) {
        const next = {
            ...this.args.config,
            [section]: patch
        } as AgentConfig
        await writeConfig(this.ctx, next)
        this._setConfig(next)
        await afterSave?.(next)
        await this.refreshConsoleData()
    }
}

function itemFromInfo(info: SubAgentInfo, enabled: boolean) {
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
