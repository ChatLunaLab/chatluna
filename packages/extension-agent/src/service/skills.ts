import { SystemMessage } from '@langchain/core/messages'
import { Context } from 'koishi'
import { getSkillsRootPath } from '../config/path'
import {
    AgentConfig,
    SkillContentResult,
    SkillExportResult,
    SkillInfo,
    SkillImportInput,
    SkillImportResult,
    SkillsStatus
} from '../types'
import { ensureSkillsRoot, ScannedSkill, scanSkills } from '../skills/scan'
import { escapeXml, renderSkillContent } from '../skills/render'
import { getSlashSkillName, stripSlashSkillName } from '../skills/slash'
import { importSkills as runImportSkills } from '../skills/import'
import { exportSkillArchive, removeSkillDirectory } from '../skills/manage'
import { SkillTool, SkillToolService } from '../skills/tool'

export class ChatLunaAgentSkillsService implements SkillToolService {
    private _catalog: SkillInfo[] = []
    private _skills = new Map<string, ScannedSkill>()
    private _visibleByName = new Map<string, ScannedSkill>()
    private _toolDispose?: () => void
    private _providerDispose?: () => void
    private _active = new Map<string, Set<string>>()

    constructor(
        public ctx: Context,
        public config: AgentConfig
    ) {
        ctx.on('chatluna/before-chat', async (conversationId, message) => {
            const name = getSlashSkillName(message)
            if (name) {
                const skill = this._visibleByName.get(name)
                if (
                    skill &&
                    skill.enabled &&
                    skill.state === 'ready' &&
                    skill.userInvocable
                ) {
                    const current =
                        this._active.get(conversationId) ?? new Set<string>()
                    current.add(skill.id)
                    this._active.set(conversationId, current)
                    stripSlashSkillName(message)
                }
            }

            await this.injectConversationSkills(conversationId)
        })

        ctx.on('chatluna/clear-chat-history', async (conversationId) => {
            this._active.delete(conversationId)
        })
    }

    async start() {
        await ensureSkillsRoot(this.ctx)

        await this.reload()
    }

    async stop() {
        this._toolDispose?.()
        this._toolDispose = undefined
        this._providerDispose?.()
        this._providerDispose = undefined
        this._catalog = []
        this._skills.clear()
        this._visibleByName.clear()
        this._active.clear()
    }

    async reload() {
        const scanned = await scanSkills(this.ctx, this.config.skills)
        this._skills = new Map(scanned.map((skill) => [skill.id, skill]))
        this._catalog = this.buildCatalog(scanned)
        this._visibleByName = new Map(
            this._catalog
                .filter((skill) => skill.visible)
                .map((skill) => [skill.name, this._skills.get(skill.id)!])
        )

        this.pruneActiveSkills()
        this.syncTool()
    }

    getStatus(): SkillsStatus {
        return {
            enabled: true,
            root: this.getRoot(),
            total: this._catalog.length,
            visible: this._catalog.filter((skill) => skill.visible).length,
            modelEnabled: this._catalog.filter((skill) => skill.modelEnabled)
                .length,
            activeConversations: Array.from(this._active.values()).filter(
                (value) => value.size > 0
            ).length,
            catalog: Object.fromEntries(
                this._catalog.map((skill) => [skill.id, skill])
            )
        }
    }

    listSkills() {
        return [...this._catalog]
    }

    async getSkillContent(id: string): Promise<SkillContentResult | undefined> {
        const skill = this._skills.get(id)
        if (!skill) {
            return undefined
        }

        return {
            id,
            content: skill.raw
        }
    }

    async importSkills(input: SkillImportInput): Promise<SkillImportResult> {
        const result = await runImportSkills(this.ctx, input)
        await this.reload()
        return result
    }

    async exportSkill(id: string): Promise<SkillExportResult | undefined> {
        const skill = this._skills.get(id)
        if (!skill || !skill.path) {
            return undefined
        }

        return await exportSkillArchive(id, skill.dir)
    }

    async removeSkill(id: string): Promise<string | undefined> {
        const skill = this._skills.get(id)
        if (!skill) {
            return undefined
        }

        if (skill.source !== 'chatluna' || skill.scope !== 'data') {
            throw new Error('Only imported local skills can be removed here')
        }

        await removeSkillDirectory(this.getRoot(), skill.dir)
        return skill.name
    }

    buildToolDescription() {
        const skills = this._catalog.filter((skill) => skill.modelEnabled)
        const lines = [
            'Load a skill by name when the current task matches its description.',
            'Loaded skills add specialized instructions and stay active for the current conversation until the chat history is cleared.',
            '<available_skills>'
        ]

        for (const skill of skills) {
            lines.push(
                '  <skill>',
                `    <name>${escapeXml(skill.name)}</name>`,
                `    <description>${escapeXml(skill.description)}</description>`,
                `    <location>${escapeXml(skill.path)}</location>`,
                '  </skill>'
            )
        }

        lines.push('</available_skills>')

        if (this.config.skills.allowComputerUsePrompt) {
            lines.push(
                'If the environment exposes computer-use abilities, loaded skills may use them when needed.'
            )
        }

        return lines.join('\n')
    }

    async activateSkill(name: string, conversationId?: string) {
        const skill = this._visibleByName.get(name)

        if (!skill || !skill.enabled || skill.state !== 'ready') {
            throw new Error(`Skill not found: ${name}`)
        }

        if (!skill.implicitInvocation) {
            throw new Error(
                `Skill is not available for model invocation: ${name}`
            )
        }

        if (conversationId) {
            const current =
                this._active.get(conversationId) ?? new Set<string>()
            current.add(skill.id)
            this._active.set(conversationId, current)
        }

        return await renderSkillContent(
            skill,
            this.config.skills.allowComputerUsePrompt,
            true
        )
    }

    private getRoot() {
        return getSkillsRootPath(this.ctx)
    }

    private buildCatalog(skills: ScannedSkill[]) {
        const groups = new Map<string, ScannedSkill[]>()

        for (const skill of skills) {
            const list = groups.get(skill.name) ?? []
            list.push(skill)
            groups.set(skill.name, list)
        }

        const catalog: SkillInfo[] = []

        for (const list of groups.values()) {
            list.sort((a, b) => a.priority - b.priority)
            const winner = list.find(
                (skill) => skill.enabled && skill.state === 'ready'
            )

            for (const skill of list) {
                catalog.push({
                    id: skill.id,
                    name: skill.name,
                    description: skill.description,
                    path: skill.path,
                    dir: skill.dir,
                    source: skill.source,
                    scope: skill.scope,
                    state: skill.state,
                    enabled: skill.enabled,
                    visible: winner?.id === skill.id,
                    modelEnabled:
                        winner?.id === skill.id && skill.implicitInvocation,
                    userInvocable: skill.userInvocable,
                    implicitInvocation: skill.implicitInvocation,
                    shadowedBy:
                        winner && winner.id !== skill.id
                            ? winner.id
                            : undefined,
                    compatibility: skill.compatibility,
                    license: skill.license,
                    metadata: skill.metadata,
                    allowedTools: skill.allowedTools,
                    diagnostics: [...skill.diagnostics]
                })
            }
        }

        for (const [id, item] of Object.entries(this.config.skills.items)) {
            if (this._skills.has(id)) {
                continue
            }

            catalog.push({
                id,
                name: id,
                description: '',
                path: '',
                dir: '',
                source: 'chatluna',
                scope: 'data',
                state: 'missing',
                enabled: item.enabled,
                visible: false,
                modelEnabled: false,
                userInvocable: false,
                implicitInvocation: false,
                diagnostics: ['Configured skill was not found during scan']
            })
        }

        return catalog.sort((a, b) => {
            const aSkill = this._skills.get(a.id)
            const bSkill = this._skills.get(b.id)
            const aPriority = aSkill?.priority ?? 9999
            const bPriority = bSkill?.priority ?? 9999

            if (aPriority !== bPriority) {
                return aPriority - bPriority
            }

            return a.path.localeCompare(b.path)
        })
    }

    private pruneActiveSkills() {
        const loadable = new Set(
            this._catalog
                .filter(
                    (skill) =>
                        skill.visible &&
                        skill.enabled &&
                        skill.state === 'ready'
                )
                .map((skill) => skill.id)
        )

        for (const [conversationId, current] of this._active.entries()) {
            const next = new Set(
                Array.from(current).filter((id) => loadable.has(id))
            )

            if (next.size > 0) {
                this._active.set(conversationId, next)
                continue
            }

            this._active.delete(conversationId)
        }
    }

    private syncTool() {
        this._toolDispose?.()
        this._toolDispose = undefined

        const names = this._catalog
            .filter((skill) => skill.modelEnabled)
            .map((skill) => skill.name)

        if (names.length < 1) {
            return
        }

        this._toolDispose = this.ctx.chatluna.platform.registerTool('skill', {
            createTool: () =>
                new SkillTool(this, names as [string, ...string[]]),
            selector: () => true
        })
    }

    private async injectConversationSkills(conversationId: string) {
        const current = this._active.get(conversationId)
        if (!current || current.size < 1) {
            return
        }

        const messages = (
            await Promise.all(
                Array.from(current).map(async (id) => {
                    const skill = this._skills.get(id)
                    if (!skill || !skill.enabled || skill.state !== 'ready') {
                        return undefined
                    }

                    return new SystemMessage(
                        await renderSkillContent(
                            skill,
                            this.config.skills.allowComputerUsePrompt
                        )
                    )
                })
            )
        ).filter((message): message is SystemMessage => message != null)

        if (messages.length < 1) {
            this._active.delete(conversationId)
            return
        }

        this.ctx.chatluna.contextManager.inject({
            conversationId,
            name: 'agent_skill_context',
            value: messages,
            stage: 'injections',
            once: true
        })
    }
}
