/** @module service/skills */

import { SystemMessage } from '@langchain/core/messages'
import {
    countMessageTokens,
    PromptContextRuntime
} from 'koishi-plugin-chatluna/llm-core/prompt'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { Context } from 'koishi'
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
import { ensureSkillsRoot, ScannedSkill, scanSkills } from '../skills/scan'
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
        ctx.on('chatluna/before-chat', async (conversationId, message) => {
            const name = getSlashSkillName(message)
            if (!name) return

            const skill = this._visibleByName.get(name)
            if (
                !skill ||
                !skill.enabled ||
                skill.state !== 'ready' ||
                !skill.userInvocable
            ) {
                return
            }

            const active = this._active.get(conversationId) ?? new Set<string>()
            active.add(skill.id)
            this._active.set(conversationId, active)

            const requested =
                this._requested.get(conversationId) ?? new Set<string>()
            requested.add(skill.id)
            this._requested.set(conversationId, requested)

            stripSlashSkillName(message)
        })

        ctx.on('chatluna/clear-chat-history', async (conversationId) => {
            this._active.delete(conversationId)
            this._requested.delete(conversationId)
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
        const scanned = await scanSkills(this.ctx, this.config)
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
        return {
            enabled: true,
            root: getSkillsRootPath(this.ctx),
            total: this._catalog.length,
            visible: this._catalog.filter((s) => s.visible).length,
            modelEnabled: this._catalog.filter((s) => s.modelEnabled).length,
            activeConversations: Array.from(this._active.values()).filter(
                (s) => s.size > 0
            ).length,
            catalog: Object.fromEntries(this._catalog.map((s) => [s.id, s]))
        }
    }

    listSkills() {
        return [...this._catalog]
    }

    listVisibleSkills() {
        return this._catalog.filter(
            (s) => s.visible && s.enabled && s.state === 'ready'
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
        if (!skill?.path) return undefined
        return await exportSkillArchive(id, skill.dir)
    }

    async removeSkill(id: string): Promise<string | undefined> {
        const skill = this._skills.get(id)
        if (!skill) return undefined

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
        const sub = runConfig?.configurable?.subagentContext

        if (sub) {
            const agent = this.ctx.chatluna_agent?.subAgent
                .getCatalogSync()
                .find((item) => item.id === sub.agentId)

            if (!agent) {
                throw new Error(`Sub-agent not found: ${sub.agentId}`)
            }

            const names = this.permission.filterSkillNames(
                agent,
                this._catalog
                    .filter((item) => item.modelEnabled)
                    .map((item) => item.name)
            )

            if (!names.includes(name)) {
                throw new Error(`Skill is not available: ${name}`)
            }
        }

        if (!skill?.enabled || skill.state !== 'ready') {
            throw new Error(`Skill not found: ${name}`)
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

    private async renderActivatedSkill(
        skill: ScannedSkill,
        input: {
            conversationId?: string
            runConfig?: ChatLunaToolRunnable
        } = {}
    ) {
        const computer = this.ctx.chatluna_agent?.computer
        let session

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

        return await renderSkillContent(skill, true, {
            skillDir
        })
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
            selector: () => true
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

                const sub = runtime.configurable?.subagentContext
                const cwd =
                    this.ctx.chatluna_agent?.computer.getPromptWorkdir(
                        conversationId
                    )
                const status = this.ctx.chatluna_agent?.computer.getStatus()
                const remote =
                    status != null && status.defaultProvider !== 'local'
                const skills = sub
                    ? []
                    : this._catalog
                          .filter((s) => s.modelEnabled)
                          .map((item) => (remote ? { ...item, dir: '' } : item))
                const current = this._active.get(conversationId)
                const active = current
                    ? this._catalog
                          .filter((s) => current.has(s.id))
                          .map((item) =>
                              remote
                                  ? {
                                        ...item,
                                        dir: getRemoteSkillDir(item.name)
                                    }
                                  : item
                          )
                    : []

                if (skills.length > 0 || active.length > 0 || !sub) {
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
