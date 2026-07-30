/** @module service/index */

import { randomUUID } from 'crypto'
import { mkdir, rm, stat, writeFile } from 'fs/promises'
import os from 'node:os'
import { dirname, join, resolve } from 'path'
import { Context, Service } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { logger } from '..'
import { truncateOutput } from '../computer/backends/types'
import type { ComputerSessionApi } from '../computer/types'
import { createSubAgentItemConfig } from '../config/defaults'
import { getSubAgentsRootPath } from '../config/path'
import { readConfig } from '../config/read'
import { writeConfig } from '../config/write'
import {
    type AgentcliSyncResult,
    syncAgentcliConfig
} from '../utils/agentcli_sync'
import {
    createSubAgentMarkdown,
    getSubAgentFileName
} from '../sub-agent/markdown'
import { parseAgentFrontmatter } from '../sub-agent/parse'
import {
    AgentConfig,
    ManualSubAgentInput,
    McpToolConfig,
    SaveMcpServerInput,
    SkillExportResult,
    SkillImportInput,
    SkillImportPreviewResult,
    SkillImportResult,
    SkillMode,
    SubAgentConfig,
    SubAgentExportResult,
    SubAgentImportInput,
    SubAgentInfo,
    SubAgentItemConfig
} from '../types'
import { getErrorMessage } from '../utils/shell'
import { ChatLunaAgentComputerService } from './computer'
import { ChatLunaAgentMcpService } from './mcp'
import { ChatLunaAgentPermissionService } from './permissions'
import { ChatLunaAgentRuntimeSyncService } from '../utils/runtime_sync'
import { ChatLunaAgentSkillsService } from './skills'
import { ChatLunaAgentSubAgentService } from './sub_agent'
import { ChatLunaAgentTriggerService } from './trigger'
import { isPathInside } from '../utils/path'

export class ChatLunaAgentService extends Service {
    public computer: ChatLunaAgentComputerService
    public mcp: ChatLunaAgentMcpService
    public permission: ChatLunaAgentPermissionService
    public runtimeSync: ChatLunaAgentRuntimeSyncService
    public skills: ChatLunaAgentSkillsService
    public subAgent: ChatLunaAgentSubAgentService
    public trigger: ChatLunaAgentTriggerService
    private _toolUpdateDispose?: () => void

    constructor(
        public ctx: Context,
        public args: { config: AgentConfig; plugin: ChatLunaPlugin }
    ) {
        super(ctx, 'chatluna_agent')

        this.permission = new ChatLunaAgentPermissionService(ctx, args.config)
        this.computer = new ChatLunaAgentComputerService(ctx, args.config)
        this.mcp = new ChatLunaAgentMcpService(ctx, args.config, args.plugin)
        this.runtimeSync = new ChatLunaAgentRuntimeSyncService(ctx, () => this)
        this.skills = new ChatLunaAgentSkillsService(
            ctx,
            args.config,
            this.permission
        )
        this.subAgent = new ChatLunaAgentSubAgentService(
            ctx,
            args.config,
            this.permission
        )
        this.trigger = new ChatLunaAgentTriggerService(ctx)
    }

    async start() {
        this._toolUpdateDispose?.()
        this._toolUpdateDispose = this.ctx.on(
            'chatluna/tool-updated',
            async () => {
                this.permission.invalidateCache()
                await this.refreshConsoleData()
            }
        )

        await Promise.all([
            this.permission.start(),
            this.computer.start(),
            this.runtimeSync.start(),
            this.skills.start(),
            this.subAgent.start(),
            this.mcp.start(),
            this.trigger.start()
        ])
        this.ctx.setTimeout(() => this.refreshConsoleData(), 20)
    }

    async stop() {
        this._toolUpdateDispose?.()
        this._toolUpdateDispose = undefined
        await this.trigger.stop()
        await this.subAgent.stop()
        await this.mcp.stop()
        await this.skills.stop()
        await this.runtimeSync.stop()
        await this.computer.stop()
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
            tool: this.permission.getStatus(),
            trigger: this.trigger.getStatus()
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
        await writeConfig(this.ctx, cfg)
        this._setConfig(cfg)
        await this.reload(cfg)
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
        await this.updateConfig(
            'skills',
            {
                dirs: [...this.args.config.skills.dirs],
                items: { ...this.args.config.skills.items },
                githubToken: this.args.config.skills.githubToken ?? ''
            },
            async () => {
                await this.skills.reload()
            }
        )
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
        return await this.setSkillMode(id, enabled ? 'description' : 'off')
    }

    async setSkillMode(id: string, mode: SkillMode) {
        const skills = {
            dirs: [...this.args.config.skills.dirs],
            items: { ...this.args.config.skills.items },
            githubToken: this.args.config.skills.githubToken ?? ''
        }
        const info = this.skills.listSkills().find((item) => item.id === id)
        skills.items[id] = {
            ...skills.items[id],
            enabled: mode !== 'off',
            mode,
            remote: info?.remote || skills.items[id]?.remote === true
        }
        await this.updateConfig('skills', skills, async () => {
            await this.skills.reload()
        })
    }

    async removeSkill(id: string) {
        if (!(await this.skills.removeSkill(id))) {
            return
        }

        const skills = {
            dirs: [...this.args.config.skills.dirs],
            items: { ...this.args.config.skills.items },
            githubToken: this.args.config.skills.githubToken ?? ''
        }
        delete skills.items[id]
        await this.updateConfig('skills', skills, async () => {
            await this.skills.reload()
        })
    }

    async setSubAgentEnabled(id: string, enabled: boolean) {
        const info = this.subAgent
            .getCatalogSync()
            .find((item) => item.id === id)
        if (!info) {
            throw new Error(`Sub-agent not found: ${id}`)
        }

        if (info.source === 'manual') {
            await this.subAgent.setManualAgentEnabled(id, enabled)
            return
        }

        const subAgent = structuredClone(this.args.config.subAgent)
        if (info.source === 'builtin') {
            subAgent.builtin[info.name] = itemFromInfo(info, enabled)
        } else if (info.source === 'preset') {
            subAgent.presetAgents[info.name] = itemFromInfo(info, enabled)
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

    async previewSubAgentImport(data: string) {
        return parseAgentFrontmatter(data, 'preview')
    }

    async addSubAgent(input: ManualSubAgentInput) {
        const root = getSubAgentsRootPath(this.ctx)
        const file = join(root, getSubAgentFileName(input.name), 'index.md')
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, createSubAgentMarkdown(input), 'utf-8')
        await this.subAgent.reload()
        await this.refreshConsoleData()

        const resolved = resolve(file)
        const info = this.subAgent
            .getCatalogSync()
            .find((item) => item.path && resolve(item.path) === resolved)

        if (!info) {
            throw new Error(
                `Sub-agent was created but not found: ${input.name}`
            )
        }

        return info
    }

    async saveSubAgentContent(id: string, input: ManualSubAgentInput) {
        const info = this.subAgent
            .getCatalogSync()
            .find((item) => item.id === id)
        if (!info) {
            throw new Error(`Sub-agent not found: ${id}`)
        }

        if (info.source !== 'markdown') {
            throw new Error('Only markdown sub-agents can save content here')
        }

        if (info.remote) {
            throw new Error('Cannot edit remote sub-agent content')
        }

        if (!info.path) {
            throw new Error('Sub-agent path is missing')
        }

        if (!isPathInside(info.path, getSubAgentsRootPath(this.ctx))) {
            throw new Error(
                'Only sub-agents inside data/chatluna/agents can save content here'
            )
        }

        await writeFile(
            info.path,
            createSubAgentMarkdown({
                name: input.name,
                description: input.description,
                promptContent: input.promptContent,
                chatluna: input.chatluna ?? info.chatlunaEnabled,
                character: input.character ?? info.characterEnabled,
                characterGroup:
                    input.characterGroup ?? info.characterGroupEnabled,
                characterPrivate:
                    input.characterPrivate ?? info.characterPrivateEnabled,
                characterGroupMode:
                    input.characterGroupMode ?? info.characterGroupMode,
                characterPrivateMode:
                    input.characterPrivateMode ?? info.characterPrivateMode,
                characterGroupIds:
                    input.characterGroupIds ?? info.characterGroupIds,
                characterPrivateIds:
                    input.characterPrivateIds ?? info.characterPrivateIds,
                authority: input.authority ?? info.authority,
                dedupeTools: input.dedupeTools ?? info.dedupeTools,
                model: input.model ?? info.model,
                maxTurns: input.maxTurns ?? info.maxTurns,
                hidden: input.hidden ?? info.hidden,
                enabled: input.enabled ?? info.enabled,
                allowKoishiMessageTransform:
                    input.allowKoishiMessageTransform ??
                    info.allowKoishiMessageTransform,
                permissions: input.permissions ?? info.permissions
            }),
            'utf-8'
        )
        await this.subAgent.reload()
        await this.refreshConsoleData()

        const resolved = resolve(info.path)
        const updated = this.subAgent
            .getCatalogSync()
            .find((item) => item.path && resolve(item.path) === resolved)
        if (!updated) {
            throw new Error(`Sub-agent was saved but not found: ${id}`)
        }

        return updated
    }

    async exportSubAgent(
        id: string
    ): Promise<SubAgentExportResult | undefined> {
        const info = this.subAgent
            .getCatalogSync()
            .find((item) => item.id === id)
        if (!info || !info.promptContent.trim()) {
            return undefined
        }

        return {
            id: info.id,
            name: info.name,
            fileName: `${getSubAgentFileName(info.name)}.md`,
            content: createSubAgentMarkdown({
                name: info.name,
                description: info.description,
                chatluna: info.chatlunaEnabled,
                character: info.characterEnabled,
                characterGroup: info.characterGroupEnabled,
                characterPrivate: info.characterPrivateEnabled,
                characterGroupMode: info.characterGroupMode,
                characterPrivateMode: info.characterPrivateMode,
                characterGroupIds: info.characterGroupIds,
                characterPrivateIds: info.characterPrivateIds,
                authority: info.authority,
                dedupeTools: info.dedupeTools,
                promptContent: info.promptContent,
                model: info.model,
                maxTurns: info.maxTurns,
                hidden: info.hidden,
                enabled: info.enabled,
                allowKoishiMessageTransform: info.allowKoishiMessageTransform,
                permissions: info.permissions
            })
        }
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
            dedupeTools: config.dedupeTools,
            name,
            description: config.description ?? name,
            chatluna: config.chatluna,
            character: config.character,
            characterGroup: config.characterGroup,
            characterPrivate: config.characterPrivate,
            characterGroupMode: config.characterGroupMode,
            characterPrivateMode: config.characterPrivateMode,
            characterGroupIds: config.characterGroupIds,
            characterPrivateIds: config.characterPrivateIds,
            authority: config.authority,
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
            if (info.remote) {
                const subAgent = structuredClone(this.args.config.subAgent)
                delete subAgent.items[id]
                await this.updateConfig('subAgent', subAgent, async () => {
                    await this.subAgent.reload()
                })
                return
            }

            if (!info.path) {
                throw new Error('Sub-agent path is missing')
            }

            const root = resolve(getSubAgentsRootPath(this.ctx))
            const file = resolve(info.path)
            if (!isPathInside(file, root)) {
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

    async stopSubAgentTask(id?: string) {
        const task = id?.trim()
            ? this.subAgent.getTask(id.trim())
            : this.subAgent.getLatestRunningTask()

        if (!task) return 0
        return await this.subAgent.stopTaskTree(task.id)
    }

    async getToolAvailability() {
        return this.permission.getToolAvailability()
    }

    async getPresetNames() {
        return this.ctx.chatluna.preset.getAllPreset(false).value
    }

    async truncateTextOutput(input: {
        name: string
        text: string
        limit?: number
        session?: ComputerSessionApi
        outputDir?: string
        outputPath?: string
        totalLength?: number
    }) {
        const limit = input.limit ?? 8000
        const length = input.totalLength ?? input.text.length
        if (length <= limit) return input.text

        if (input.outputPath) {
            return `${truncateOutput(input.text, limit)}

Output too large (${length} chars). Full output saved to: ${input.outputPath}
Use file_read with this path plus offset/limit to inspect more.
`
        }

        if (input.session) {
            const dir = (await input.session.getTempDir()).replace(
                /[\\/]+$/,
                ''
            )
            const filePath = `${dir}/${input.name}-${Date.now()}-${randomUUID()}.txt`

            try {
                await input.session.writeFile(filePath, input.text)
                return `${truncateOutput(input.text, limit)}

Output too large (${input.text.length} chars). Full output saved to: ${filePath}
Use file_read with this path plus offset/limit to inspect more.
`
            } catch (err) {
                logger.warn(err)
                return `${truncateOutput(input.text, limit)}

Output too large (${input.text.length} chars). Failed to save full output: ${getErrorMessage(err)}`
            }
        }

        const dir =
            input.outputDir ?? resolve(os.tmpdir(), 'chatluna', 'truncation')
        const filePath = join(
            dir,
            `${input.name}-${Date.now()}-${randomUUID()}.txt`
        )

        try {
            await mkdir(dir, { recursive: true })
            await writeFile(filePath, input.text, 'utf-8')
            return `${truncateOutput(input.text, limit)}

Output too large (${input.text.length} chars). Full output saved to: ${filePath}
Use file_read with this path plus offset/limit to inspect more.
`
        } catch (err) {
            logger.warn(err)
            return `${truncateOutput(input.text, limit)}

Output too large (${input.text.length} chars). Failed to save full output: ${getErrorMessage(err)}`
        }
    }

    async updateConfigPath(
        path: string,
        operation: 'set' | 'remove',
        value?: unknown
    ) {
        const parts = path
            .split('.')
            .map((item) => item.trim())
            .filter(Boolean)
        if (parts.length < 1) {
            throw new Error('Config path is required')
        }

        const prev = this.args.config
        const next = structuredClone(prev) as AgentConfig
        if (operation === 'remove') {
            deleteConfigValue(next as unknown as Record<string, unknown>, parts)
        } else {
            setConfigValue(
                next as unknown as Record<string, unknown>,
                parts,
                value
            )
        }

        await writeConfig(this.ctx, next)
        this._setConfig(next)
        await this.afterConfigUpdate(parts[0] as keyof AgentConfig, prev, next)
        await this.refreshConsoleData()

        return {
            path,
            operation,
            section: parts[0],
            value: getConfigValue(
                next as unknown as Record<string, unknown>,
                parts
            )
        }
    }

    async syncAgentcliConfig(): Promise<AgentcliSyncResult> {
        return await syncAgentcliConfig(this)
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

    private async afterConfigUpdate(
        section: keyof AgentConfig,
        prev: AgentConfig,
        next: AgentConfig
    ) {
        if (section === 'mcp') {
            await this.mcp.sync(prev.mcp, next.mcp)
            return
        }

        if (section === 'skills') {
            await this.skills.reload()
            return
        }

        if (section === 'computer') {
            await this.computer.reload()
            await this.skills.reload()
            return
        }

        if (section === 'subAgent') {
            await this.subAgent.reload()
        }
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
        dedupeTools: info.dedupeTools,
        name: info.name,
        description: info.description,
        chatluna: info.chatlunaEnabled,
        character: info.characterEnabled,
        characterGroup: info.characterGroupEnabled,
        characterPrivate: info.characterPrivateEnabled,
        characterGroupMode: info.characterGroupMode,
        characterPrivateMode: info.characterPrivateMode,
        characterGroupIds: info.characterGroupIds,
        characterPrivateIds: info.characterPrivateIds,
        authority: info.authority,
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

function getConfigValue(
    root: Record<string, unknown>,
    parts: string[]
): unknown {
    let current: unknown = root
    for (const part of parts) {
        if (typeof current !== 'object' || current == null) {
            return undefined
        }

        current = (current as Record<string, unknown>)[part]
    }

    return current
}

function setConfigValue(
    root: Record<string, unknown>,
    parts: string[],
    value: unknown
) {
    let current: unknown = root
    for (let idx = 0; idx < parts.length - 1; idx++) {
        const part = parts[idx]
        const next = parts[idx + 1]
        if (typeof current !== 'object' || current == null) {
            throw new Error(`Invalid config path: ${parts.join('.')}`)
        }

        const target = current as Record<string, unknown>
        if (target[part] == null || typeof target[part] !== 'object') {
            target[part] = /^\d+$/.test(next) ? [] : {}
        }

        current = target[part]
    }

    if (typeof current !== 'object' || current == null) {
        throw new Error(`Invalid config path: ${parts.join('.')}`)
    }

    ;(current as Record<string, unknown>)[parts[parts.length - 1]] = value
}

function deleteConfigValue(root: Record<string, unknown>, parts: string[]) {
    let current: unknown = root
    for (let idx = 0; idx < parts.length - 1; idx++) {
        const part = parts[idx]
        if (typeof current !== 'object' || current == null) {
            return
        }

        current = (current as Record<string, unknown>)[part]
    }

    if (typeof current !== 'object' || current == null) {
        return
    }

    delete (current as Record<string, unknown>)[parts[parts.length - 1]]
}
