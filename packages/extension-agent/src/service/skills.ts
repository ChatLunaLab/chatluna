/** @module service/skills */

import { writeFile } from 'fs/promises'
import { SystemMessage } from '@langchain/core/messages'
import type {} from 'koishi-plugin-chatluna/llm-core/chat/app'
import type { ToolMask } from 'koishi-plugin-chatluna/llm-core/agent'
import {
    countMessageTokens,
    PromptContextRuntime
} from 'koishi-plugin-chatluna/llm-core/prompt'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { Context, Session } from 'koishi'
import { getSkillsRootPath } from '../config/path'
import {
    AgentConfig,
    SkillContentResult,
    SkillExportResult,
    SkillImportInput,
    SkillImportPreviewResult,
    SkillImportResult,
    SkillInfo,
    SkillsStatus,
    SkillToolService
} from '../types'
import { syncBundledSkills } from '../skills/builtin'
import {
    ensureSkillsRoot,
    listRemoteSkillResources,
    ScannedSkill,
    scanSkills
} from '../skills/scan'
import { renderAvailableSkills, renderSkillContent } from '../skills/render'
import { getSlashSkillName, stripSlashSkillName } from '../skills/slash'
import {
    previewSkillsImport,
    importSkills as runImportSkills
} from '../skills/import'
import { exportSkillArchive, removeSkillDirectory } from '../skills/manage'
import { watchSkillFiles } from '../skills/watch'
import { SkillTool } from '../skills/tool'
import { buildSkillCatalog } from '../skills/catalog'
import { getRemoteSkillDir, getRemoteSkillsRoot } from '../computer/materialize'
import { ChatLunaAgentPermissionService } from './permissions'
import { ComputerSessionApi } from '../computer/types'

export class ChatLunaAgentSkillsService implements SkillToolService {
    private _catalog: SkillInfo[] = []
    private _skills = new Map<string, ScannedSkill>()
    private _visibleByName = new Map<string, ScannedSkill>()
    private _toolDispose?: () => void
    private _promptDispose?: () => void
    private _watchDispose?: () => void
    private _active = new Map<string, Set<string>>()
    private _requested = new Map<string, Set<string>>()

    constructor(
        public ctx: Context,
        public config: AgentConfig,
        private permission: ChatLunaAgentPermissionService
    ) {
        ctx.on(
            'chatluna/before-chat',
            async (conversationId, message, _vars, _chat, session) => {
                const name = getSlashSkillName(message)
                if (!name) return

                const skill = this._visibleByName.get(name)
                if (
                    !skill ||
                    !this.canUseSkill(skill.id, session, 'chatluna') ||
                    !skill.userInvocable
                ) {
                    return
                }

                const active =
                    this._active.get(conversationId) ?? new Set<string>()
                active.add(skill.id)
                this._active.set(conversationId, active)

                const requested =
                    this._requested.get(conversationId) ?? new Set<string>()
                requested.add(skill.id)
                this._requested.set(conversationId, requested)

                stripSlashSkillName(message)
            }
        )

        const clear = (conversationId: string) => {
            this._active.delete(conversationId)
            this._requested.delete(conversationId)
        }

        ctx.on('chatluna/after-conversation-clear-history', async (payload) => {
            clear(payload.conversation.id)
        })
        ctx.on('chatluna/after-conversation-delete', async (payload) => {
            clear(payload.conversation.id)
        })
    }

    async start() {
        await ensureSkillsRoot(this.ctx)
        await this.reload()
    }

    async stop() {
        this._watchDispose?.()
        this._watchDispose = undefined
        this._toolDispose?.()
        this._toolDispose = undefined
        this._promptDispose?.()
        this._promptDispose = undefined
        this._catalog = []
        this._skills.clear()
        this._visibleByName.clear()
        this._active.clear()
        this._requested.clear()
    }

    async reload() {
        await syncBundledSkills(this.ctx)
        const local = await scanSkills(this.ctx, this.config)
        const scanned = local
        this._skills = new Map(scanned.map((s) => [s.id, s]))
        this._catalog = buildSkillCatalog(scanned, this.config.skills.items)
        this._visibleByName = new Map(
            this._catalog
                .filter((s) => s.visible)
                .map((s) => [s.name, this._skills.get(s.id)!])
        )

        this.pruneActiveSkills()
        this.syncTool()
        this.syncPrompt()
        await this.syncWatch()
    }

    getStatus(): SkillsStatus {
        const catalog = this.getDisplayCatalog()
        return {
            enabled: true,
            root: getSkillsRootPath(this.ctx),
            total: catalog.length,
            visible: catalog.filter((s) => s.visible).length,
            modelEnabled: catalog.filter((s) => s.modelEnabled).length,
            activeConversations: Array.from(this._active.values()).filter(
                (s) => s.size > 0
            ).length,
            catalog: Object.fromEntries(catalog.map((s) => [s.id, s]))
        }
    }

    listSkills() {
        return this.getDisplayCatalog()
    }

    listVisibleSkills() {
        return this._catalog.filter(
            (s) => s.visible && s.enabled && s.state === 'ready' && s.main
        )
    }

    getScannedSkill(id: string) {
        return this._skills.get(id)
    }

    getVisibleSkillByName(name: string) {
        return this._visibleByName.get(name)
    }

    hasActiveSkill(conversationId: string, name: string) {
        const skill = this._visibleByName.get(name)
        if (!skill) {
            return false
        }

        return this._active.get(conversationId)?.has(skill.id) === true
    }

    listActiveSkills(conversationId: string) {
        const active = this._active.get(conversationId)
        if (!active) {
            return [] as SkillInfo[]
        }

        return this._catalog.filter((item) => active.has(item.id))
    }

    async getSkillContent(id: string): Promise<SkillContentResult | undefined> {
        const skill = this._skills.get(id)
        if (!skill) return undefined
        return { id, content: skill.raw }
    }

    async saveSkillContent(id: string, content: string) {
        const skill = this._skills.get(id)
        if (!skill) {
            throw new Error(`Skill not found: ${id}`)
        }

        if (skill.remote) {
            throw new Error('Cannot edit remote skill content')
        }

        await writeFile(skill.path, content, 'utf-8')

        await this.reload()
    }

    async previewImport(
        input: SkillImportInput
    ): Promise<SkillImportPreviewResult> {
        return await previewSkillsImport(this.ctx, input)
    }

    async importSkills(input: SkillImportInput): Promise<SkillImportResult> {
        return await runImportSkills(this.ctx, input)
    }

    async exportSkill(id: string): Promise<SkillExportResult | undefined> {
        const skill = this._skills.get(id)
        if (!skill?.path || skill.remote) return undefined
        return await exportSkillArchive(id, skill.dir)
    }

    async removeSkill(id: string): Promise<string | undefined> {
        const skill = this._skills.get(id)
        if (!skill) return undefined

        if (skill.remote) {
            await this.ctx.chatluna_agent?.computer.removeRemoteSkill(skill.dir)
            return skill.name
        }

        if (skill.source !== 'chatluna' || skill.scope !== 'data') {
            throw new Error('Only imported local skills can be removed here')
        }

        await removeSkillDirectory(getSkillsRootPath(this.ctx), skill.dir)
        return skill.name
    }

    buildToolDescription() {
        const lines = [
            'Load a skill when the current task clearly matches one of the injected available skills.',
            'Use the exact skill name from the injected catalog.',
            'The tool response returns the full instructions for that skill.'
        ]

        if (this.hasComputer()) {
            lines.push(
                'If the environment exposes computer-use abilities, loaded skills may use them when needed.'
            )
        }

        return lines.join('\n')
    }

    async activateSkill(name: string, runConfig?: ChatLunaToolRunnable) {
        const skill = this._visibleByName.get(name)
        const conversationId = runConfig?.configurable?.conversationId
        const sub = runConfig?.configurable?.agentContext?.subagentContext
        const session = runConfig?.configurable?.session
        const source =
            (runConfig?.configurable as { source?: 'chatluna' | 'character' })
                ?.source ?? 'chatluna'

        if (sub) {
            const agent = this.ctx.chatluna_agent?.subAgent
                .getCatalogSync()
                .find((item) => item.id === sub.agentId)

            if (!agent) {
                throw new Error(`Sub-agent not found: ${sub.agentId}`)
            }

            const names = this.permission
                .filterSkills(
                    agent,
                    this._catalog.filter((item) => item.modelEnabled)
                )
                .map((item) => item.name)

            if (!names.includes(name)) {
                throw new Error(`Skill is not available: ${name}`)
            }
        }

        if (!skill?.enabled || skill.state !== 'ready') {
            throw new Error(`Skill not found: ${name}`)
        }

        if (!this.canUseSkill(skill.id, session, source)) {
            throw new Error(`Skill is not available: ${name}`)
        }

        if (!skill.implicitInvocation) {
            throw new Error(
                `Skill is not available for model invocation: ${name}`
            )
        }

        if (conversationId) {
            const active = this._active.get(conversationId) ?? new Set<string>()
            active.add(skill.id)
            this._active.set(conversationId, active)
        }

        return await this.renderActivatedSkill(skill, {
            conversationId,
            runConfig
        })
    }

    async renderSkill(name: string, loaded = false) {
        const skill = this._visibleByName.get(name)
        if (!skill?.enabled || skill.state !== 'ready') return undefined

        return await renderSkillContent(skill, loaded)
    }

    private hasComputer() {
        return (
            (this.ctx.chatluna_agent?.computer.listAvailableBackends().length ??
                0) > 0
        )
    }

    private canUseSkill(
        id: string,
        session?: Session,
        source: 'chatluna' | 'character' = 'chatluna'
    ) {
        const item = this._catalog.find((skill) => skill.id === id)
        if (!item || !item.enabled || item.state !== 'ready' || !item.main) {
            return false
        }

        if (!this.permission.hasAuthority(session, item.authority)) {
            return false
        }

        return this.permission.isSessionAllowed(session, source, item)
    }

    private async renderActivatedSkill(
        skill: ScannedSkill,
        input: {
            conversationId?: string
            runConfig?: ChatLunaToolRunnable
            loaded?: boolean
        } = {}
    ) {
        const computer = this.ctx.chatluna_agent?.computer
        let session: ComputerSessionApi

        if (this.hasComputer()) {
            if (input.runConfig) {
                session = await computer
                    ?.getToolSession(input.runConfig)
                    .catch(() => undefined)
            } else if (input.conversationId) {
                session = await computer
                    ?.getOrCreateSession({
                        conversationId: input.conversationId
                    })
                    .catch(() => undefined)
            }
        }

        const skillDir =
            session != null
                ? await computer?.materializer.materialize(skill, session)
                : undefined
        const resources =
            session != null && skill.remote
                ? await listRemoteSkillResources(session, skillDir ?? skill.dir)
                : undefined

        return await renderSkillContent(skill, input.loaded ?? true, {
            skillDir,
            resources
        })
    }

    private async getPromptActiveSkills(
        conversationId: string,
        remote: boolean
    ) {
        const current = this._active.get(conversationId)
        if (!current) {
            return [] as SkillInfo[]
        }

        const items = this._catalog.filter((item) => current.has(item.id))
        if (!remote) {
            return items
        }

        const computer = this.ctx.chatluna_agent?.computer
        const session = await computer
            ?.getOrCreateSession({ conversationId })
            .catch(() => undefined)

        return await Promise.all(
            items.map(async (item) => {
                if (item.remote || !session || !computer) {
                    return {
                        ...item,
                        dir: item.remote
                            ? item.dir
                            : getRemoteSkillDir(item.name)
                    }
                }

                const skill = this._skills.get(item.id)
                if (!skill) {
                    return {
                        ...item,
                        dir: getRemoteSkillDir(item.name)
                    }
                }

                const dir = await computer.materializer
                    .materialize(skill, session)
                    .catch(() => getRemoteSkillDir(item.name))

                return {
                    ...item,
                    dir
                }
            })
        )
    }

    private pruneActiveSkills() {
        const loadable = new Set(
            this._catalog
                .filter((s) => s.visible && s.enabled && s.state === 'ready')
                .map((s) => s.id)
        )

        for (const [conversationId, current] of this._active.entries()) {
            const next = new Set(
                Array.from(current).filter((id) => loadable.has(id))
            )

            if (next.size > 0) {
                this._active.set(conversationId, next)
            } else {
                this._active.delete(conversationId)
            }
        }
    }

    private getDisplayCatalog() {
        return this._catalog.filter((item) => !item.shadowedBy)
    }

    private syncTool() {
        this._toolDispose?.()
        this._toolDispose = undefined

        const names = this._catalog
            .filter((s) => s.modelEnabled)
            .map((s) => s.name)

        if (names.length < 1) return

        this._toolDispose = this.ctx.chatluna.platform.registerTool('skill', {
            description: this.buildToolDescription(),
            createTool: () => new SkillTool(this),
            selector: () => true,
            authorization: (session) =>
                this._catalog.some(
                    (item) =>
                        item.modelEnabled &&
                        this.canUseSkill(item.id, session, 'chatluna')
                )
        })
    }

    private syncPrompt() {
        this._promptDispose?.()
        this._promptDispose = undefined

        this._promptDispose = this.ctx.chatluna.contextManager.pipeline(
            'after_system_prompts',
            async (runtime: PromptContextRuntime, next) => {
                const conversationId = runtime.configurable?.conversationId
                if (!conversationId) return next()

                const sub =
                    (
                        runtime.configurable?.agentContext as {
                            subagentContext?: ChatLunaToolRunnable['configurable']['agentContext'] extends infer T
                                ? T extends { subagentContext?: infer U }
                                    ? U
                                    : never
                                : never
                        }
                    )?.subagentContext ?? runtime.configurable?.subagentContext
                const session = runtime.configurable?.session
                const source =
                    (
                        runtime.configurable as {
                            source?: 'chatluna' | 'character'
                        }
                    )?.source ?? 'chatluna'
                const cwd =
                    this.ctx.chatluna_agent?.computer.getPromptWorkdir(
                        conversationId
                    )
                const status = this.ctx.chatluna_agent?.computer.getStatus()
                const remote =
                    status != null && status.defaultProvider !== 'local'
                const mask = (runtime.configurable as { toolMask?: ToolMask })
                    ?.toolMask
                const hasTool =
                    mask == null ||
                    this.ctx.chatluna.platform
                        .getFilteredTools(mask)
                        .includes('skill')
                const prompt = this._catalog.filter(
                    (s) => s.mode === 'full' && s.available
                )
                const agent = sub
                    ? this.ctx.chatluna_agent?.subAgent
                          .getCatalogSync()
                          .find((item) => item.id === sub.agentId)
                    : undefined
                const full = sub
                    ? agent
                        ? this.permission.filterSkills(agent, prompt)
                        : []
                    : prompt.filter((s) =>
                          this.canUseSkill(s.id, session, source)
                      )
                const skills =
                    sub || !hasTool
                        ? []
                        : this._catalog
                              .filter(
                                  (s) =>
                                      s.modelEnabled &&
                                      this.canUseSkill(s.id, session, source)
                              )
                              .map((item) =>
                                  remote ? { ...item, dir: '' } : item
                              )
                const active = await this.getPromptActiveSkills(
                    conversationId,
                    remote
                )

                for (const item of full) {
                    const skill = this._skills.get(item.id)
                    if (!skill) continue

                    const msg = new SystemMessage(
                        await this.renderActivatedSkill(skill, {
                            conversationId,
                            loaded: false
                        })
                    )
                    runtime.result.push(msg)
                    runtime.usedTokens += await countMessageTokens(
                        msg,
                        runtime.tokenCounter
                    )
                }

                if (skills.length > 0 || active.length > 0) {
                    const msg = renderAvailableSkills(
                        skills,
                        active,
                        remote
                            ? getRemoteSkillsRoot()
                            : getSkillsRootPath(this.ctx),
                        cwd,
                        remote ? 'remote' : 'local'
                    )
                    runtime.result.push(msg)
                    runtime.usedTokens += await countMessageTokens(
                        msg,
                        runtime.tokenCounter
                    )
                }

                const requested = this._requested.get(conversationId)
                if (!requested || requested.size < 1) return next()

                this._requested.delete(conversationId)

                for (const id of requested) {
                    const skill = this._skills.get(id)
                    if (!skill?.enabled || skill.state !== 'ready') continue

                    const msg = new SystemMessage(
                        await this.renderActivatedSkill(skill, {
                            conversationId
                        })
                    )
                    runtime.result.push(msg)
                    runtime.usedTokens += await countMessageTokens(
                        msg,
                        runtime.tokenCounter
                    )
                }

                return next()
            },
            10
        )
    }

    private async syncWatch() {
        this._watchDispose?.()
        this._watchDispose = await watchSkillFiles(
            this.ctx,
            this.config.skills,
            async () => {
                await this.reload()
                await this.ctx.chatluna_agent?.refreshConsoleData()
            }
        )
    }
}
