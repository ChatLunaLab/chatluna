/** @module service/permissions */

import { applyToolMask, ToolMask } from 'koishi-plugin-chatluna/llm-core/agent'
import { Context, Session, User } from 'koishi'
import {
    createPermissionRule,
    createSkillItemConfig,
    createToolItemConfig
} from '../config/defaults'
import {
    AgentConfig,
    ComputerBackendType,
    createToolDefaultAvailability,
    PermissionRule,
    SkillInfo,
    SubAgentInfo,
    SubAgentPermissionConfig,
    ToolAvailabilityInfo,
    ToolInfo,
    ToolStatus
} from '../types'
import { WRITE_TOOL_PATTERNS } from '../sub-agent/scan'

export class ChatLunaAgentPermissionService {
    private _toolMaskDispose?: () => void
    private _toolCache: ToolInfo[] | null = null
    private _toolMap: Map<string, ToolInfo> | null = null
    private _toolCacheKey: string | null = null

    constructor(
        public ctx: Context,
        public config: AgentConfig
    ) {}

    async start() {
        this._toolMaskDispose =
            this.ctx.chatluna.platform.registerToolMaskResolver(
                'agent',
                async ({ conversation, session, source }) => {
                    if (conversation && conversation.chatMode !== 'plugin') {
                        return
                    }

                    const mask = this.createMainToolMask(session, source)
                    return {
                        ...mask,
                        toolCallMask: await this.createToolCallMask(
                            session,
                            mask
                        )
                    }
                }
            )
    }

    async stop() {
        this._toolMaskDispose?.()
        this._toolMaskDispose = undefined
    }

    mergeRule(rule: PermissionRule, fallback: PermissionRule): PermissionRule {
        const src = rule.mode !== 'inherit' ? rule : fallback
        return { mode: src.mode, allow: [...src.allow], deny: [...src.deny] }
    }

    mergePermissions(
        rules: SubAgentPermissionConfig
    ): SubAgentPermissionConfig {
        return {
            skills: this.mergeRule(
                rules.skills,
                this.config.subAgent.defaults.skills
            ),
            mcp: this.mergeRule(rules.mcp, this.config.subAgent.defaults.mcp),
            tools: this.mergeRule(
                rules.tools,
                this.config.subAgent.defaults.tools
            ),
            computer: this.mergeRule(
                rules.computer,
                this.config.subAgent.defaults.computer
            )
        }
    }

    filterSkillNames(info: SubAgentInfo, names: string[]) {
        const rule = this.mergeRule(
            info.permissions.skills,
            this.config.subAgent.defaults.skills
        )

        return names.filter((name) => matchRuleIgnoreCase(name, rule))
    }

    filterSkills(info: SubAgentInfo, items: SkillInfo[]) {
        const rule = this.mergeRule(
            info.permissions.skills,
            this.config.subAgent.defaults.skills
        )

        return items.filter((item) => {
            if (!matchRuleIgnoreCase(item.name, rule)) {
                return false
            }

            const cfg = createSkillItemConfig(this.config.skills.items[item.id])
            return matchRule(info.id, cfg.subAgents)
        })
    }

    filterComputerBackends(info: SubAgentInfo, names: ComputerBackendType[]) {
        const rule =
            info.permissions.computer.mode === 'inherit'
                ? this.config.subAgent.defaults.computer
                : info.permissions.computer

        if (rule.mode === 'allow') {
            const allow = rule.allow.filter(isComputerBackend)
            return names.filter((name) => allow.includes(name))
        }

        if (rule.mode === 'deny') {
            const deny = rule.deny.filter(isComputerBackend)
            return names.filter((name) => !deny.includes(name))
        }

        return [...names]
    }

    listTools(): ToolInfo[] {
        const registry = this.getRegistry()
        const key = JSON.stringify(
            Object.values(registry)
                .map((item) => ({
                    name: item.name,
                    description: item.description,
                    meta: item.meta
                }))
                .sort((a, b) => a.name.localeCompare(b.name))
        )
        if (this._toolCache && this._toolCacheKey === key) {
            return this._toolCache
        }

        const list = Object.values(registry)
            .map((item) => {
                const saved = this.config.tool.items[item.name]
                const avail = createToolDefaultAvailability(item.meta)
                const cfg = createToolItemConfig(
                    {
                        ...saved,
                        enabled: saved?.enabled ?? avail?.enabled ?? true,
                        main: saved?.main ?? avail?.main ?? true,
                        chatluna: saved?.chatluna ?? avail?.chatluna ?? true,
                        character:
                            saved?.character ??
                            (avail?.characterScope == null
                                ? true
                                : avail.characterScope !== 'none'),
                        characterGroup:
                            saved?.characterGroup ??
                            (avail?.characterScope == null
                                ? true
                                : avail.characterScope === 'all' ||
                                  avail.characterScope === 'group'),
                        characterPrivate:
                            saved?.characterPrivate ??
                            (avail?.characterScope == null
                                ? true
                                : avail.characterScope === 'all' ||
                                  avail.characterScope === 'private'),
                        characterGroupMode: saved?.characterGroupMode ?? 'all',
                        characterPrivateMode:
                            saved?.characterPrivateMode ?? 'all',
                        characterGroupIds: saved?.characterGroupIds ?? [],
                        characterPrivateIds: saved?.characterPrivateIds ?? []
                    },
                    item.name
                )
                return {
                    name: item.name,
                    description: item.description,
                    enabled: cfg.enabled,
                    main: cfg.main,
                    chatlunaEnabled: cfg.chatluna,
                    characterEnabled: cfg.character,
                    characterGroupEnabled: cfg.characterGroup,
                    characterPrivateEnabled: cfg.characterPrivate,
                    characterGroupMode: cfg.characterGroupMode,
                    characterPrivateMode: cfg.characterPrivateMode,
                    characterGroupIds: cfg.characterGroupIds,
                    characterPrivateIds: cfg.characterPrivateIds,
                    subAgents: cfg.subAgents,
                    authority: cfg.authority,
                    source: item.meta?.source,
                    group: item.meta?.group,
                    tags: item.meta?.tags,
                    isMcp: item.meta?.isMcp === true,
                    serverName: item.meta?.serverName
                } satisfies ToolInfo
            })
            .sort((a, b) => a.name.localeCompare(b.name))

        this._toolCache = list
        this._toolMap = new Map(list.map((item) => [item.name, item]))
        this._toolCacheKey = key
        return list
    }

    invalidateCache() {
        this._toolCache = null
        this._toolMap = null
        this._toolCacheKey = null
    }

    getStatus(): ToolStatus {
        const list = this.listTools()
        return {
            enabled: list.length > 0,
            total: list.length,
            mainEnabled: list.filter((item) => item.enabled && item.main)
                .length,
            subAgentEnabled: list.filter(
                (item) => item.enabled && hasSubAgentAccess(item.subAgents)
            ).length,
            catalog: Object.fromEntries(list.map((item) => [item.name, item]))
        }
    }

    getToolAvailability(): ToolAvailabilityInfo[] {
        const agents =
            this.ctx.chatluna_agent?.subAgent.listRunnableAgents() ?? []
        return this.listTools().map((item) => ({
            name: item.name,
            description: item.description,
            enabled: item.enabled,
            main: item.main,
            chatlunaEnabled: item.chatlunaEnabled,
            characterEnabled: item.characterEnabled,
            characterGroupEnabled: item.characterGroupEnabled,
            characterPrivateEnabled: item.characterPrivateEnabled,
            characterGroupMode: item.characterGroupMode,
            characterPrivateMode: item.characterPrivateMode,
            source: item.source,
            group: item.group,
            tags: item.tags,
            agents: agents
                .filter((agent) => this.canUseTool(agent, item.name))
                .map((agent) => agent.name)
        }))
    }

    createMainToolMask(
        session?: Session,
        source: string = 'chatluna'
    ): ToolMask {
        const tools = this.listTools()
        const allNames = tools.map((item) => item.name)
        const allow = tools
            .filter(
                (item) =>
                    item.enabled &&
                    item.main &&
                    this.isSessionAllowed(session, source, item)
            )
            .map((item) => item.name)

        return buildToolMask(allNames, allow)
    }

    async createSubAgentToolMask(
        info: SubAgentInfo,
        session?: Session,
        source: string = 'chatluna'
    ): Promise<ToolMask> {
        const tools = this.listTools()
        const allNames = tools.map((item) => item.name)
        const allow = tools
            .filter(
                (item) =>
                    this.canUseTool(info, item.name) &&
                    this.isSessionAllowed(session, source, item)
            )
            .map((item) => item.name)
        const mask = buildToolMask(allNames, allow)
        return {
            ...mask,
            toolCallMask: await this.createToolCallMask(session, mask)
        }
    }

    async createToolCallMask(session?: Session, mask?: ToolMask) {
        const allNames = this.listTools()
            .map((item) => item.name)
            .filter((name) => applyToolMask(name, mask))
        const allow = allNames.filter((name) =>
            this.hasAuthority(session, this.getTool(name)?.authority)
        )
        return buildToolMask(allNames, allow)
    }

    hasAuthority(session?: Session, authority = 0) {
        return (
            ((session as Session<User.Field> | undefined)?.user?.[
                'authority'
            ] ?? 0) >= authority
        )
    }

    isSessionAllowed(
        session: Session | undefined,
        source: string,
        item: {
            chatlunaEnabled: boolean
            characterEnabled: boolean
            characterGroupEnabled: boolean
            characterPrivateEnabled: boolean
            characterGroupMode: 'all' | 'allow' | 'deny'
            characterPrivateMode: 'all' | 'allow' | 'deny'
            characterGroupIds: string[]
            characterPrivateIds: string[]
        }
    ) {
        if (source === 'chatluna') {
            return item.chatlunaEnabled
        }

        if (!item.characterEnabled) {
            return false
        }

        const id = session?.isDirect
            ? session.userId
            : (session?.guildId ?? session?.channelId)

        if (session?.isDirect === true) {
            if (!item.characterPrivateEnabled) {
                return false
            }

            if (item.characterPrivateMode === 'allow') {
                return item.characterPrivateIds.includes(id)
            }

            if (item.characterPrivateMode === 'deny') {
                return !item.characterPrivateIds.includes(id)
            }

            return true
        }

        if (!item.characterGroupEnabled) {
            return false
        }

        if (item.characterGroupMode === 'allow') {
            return item.characterGroupIds.includes(id)
        }

        if (item.characterGroupMode === 'deny') {
            return !item.characterGroupIds.includes(id)
        }

        return true
    }

    canUseSubAgent(
        info: SubAgentInfo,
        session?: Session,
        source: string = 'chatluna'
    ) {
        if (!info.enabled || info.state !== 'ready') {
            return false
        }

        if (!this.hasAuthority(session, info.authority)) {
            return false
        }

        return this.isSessionAllowed(session, source, info)
    }

    canUseTool(info: SubAgentInfo, name: string): boolean {
        const tool = this.getTool(name)
        if (!tool?.enabled) {
            return false
        }

        if (!matchRule(info.id, tool.subAgents)) {
            return false
        }

        const rule = this.mergeRule(
            info.permissions.tools,
            this.config.subAgent.defaults.tools
        )

        if (!matchRule(name, rule)) {
            return false
        }

        if (
            tool.isMcp &&
            !matchRule(
                tool.serverName ?? '',
                this.mergeRule(
                    info.permissions.mcp,
                    this.config.subAgent.defaults.mcp
                )
            )
        ) {
            return false
        }

        if (tool.tags?.includes('computer')) {
            if (
                this.filterComputerBackends(
                    info,
                    this.ctx.chatluna_agent?.computer.listAvailableBackends() ??
                        []
                ).length < 1
            ) {
                return false
            }
        }

        if (
            (info.name === 'plan' || info.name === 'explore') &&
            isWriteTool(name)
        ) {
            return false
        }

        return name !== 'task'
    }

    getRegistry() {
        return Object.fromEntries(
            Object.values(this.ctx.chatluna.platform.getToolRegistry()).map(
                (item) => {
                    const saved = this.config.tool.registry?.[item.name]
                    const avail = {
                        ...(createToolDefaultAvailability(item.meta) ?? {}),
                        ...(createToolDefaultAvailability(saved) ?? {})
                    }
                    return [
                        item.name,
                        {
                            name: item.name,
                            description: item.description,
                            meta: {
                                ...item.meta,
                                source: saved?.source ?? item.meta?.source,
                                group: saved?.group ?? item.meta?.group,
                                tags:
                                    saved?.tags && saved.tags.length > 0
                                        ? saved.tags
                                        : item.meta?.tags,
                                defaultAvailability:
                                    Object.keys(avail).length > 0
                                        ? avail
                                        : undefined
                            }
                        }
                    ]
                }
            )
        )
    }

    private getTool(name: string) {
        this.listTools()
        return this._toolMap?.get(name)
    }
}

function buildToolMask(allNames: string[], allow: string[]): ToolMask {
    if (allow.length >= allNames.length) {
        return { mode: 'all', tools: allNames, allow: [], deny: [] }
    }

    const deny = allNames.filter((name) => !allow.includes(name))
    if (allow.length <= deny.length) {
        return { mode: 'allow', tools: allNames, allow, deny: [] }
    }

    return { mode: 'deny', tools: allNames, allow: [], deny }
}

function matchRule(name: string, rule: PermissionRule) {
    if (rule.mode === 'allow') {
        return rule.allow.includes(name)
    }

    if (rule.mode === 'deny') {
        return !rule.deny.includes(name)
    }

    return true
}

function matchRuleIgnoreCase(name: string, rule: PermissionRule) {
    const value = name.toLowerCase()

    if (rule.mode === 'allow') {
        return rule.allow.some((item) => item.toLowerCase() === value)
    }

    if (rule.mode === 'deny') {
        return !rule.deny.some((item) => item.toLowerCase() === value)
    }

    return true
}

function hasSubAgentAccess(rule: PermissionRule) {
    return rule.mode !== 'allow' || rule.allow.length > 0
}

function isWriteTool(name: string) {
    return WRITE_TOOL_PATTERNS.some((pattern) =>
        pattern.endsWith('_') ? name.startsWith(pattern) : name === pattern
    )
}

function isComputerBackend(name: string): name is ComputerBackendType {
    return name === 'local' || name === 'e2b' || name === 'open-terminal'
}

export function createToolRule() {
    return createPermissionRule('all')
}
