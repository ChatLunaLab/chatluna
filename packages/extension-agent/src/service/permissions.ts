/** @module service/permissions */

import { ToolMask } from 'koishi-plugin-chatluna/llm-core/agent'
import { Context } from 'koishi'
import { createPermissionRule, createToolItemConfig } from '../config/defaults'
import {
    AgentConfig,
    ComputerBackendType,
    PermissionRule,
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
        this._toolMaskDispose = this.ctx.chatluna.registerToolMaskResolver(
            'agent',
            async ({ room }) => {
                if (room.chatMode !== 'plugin') {
                    return
                }

                return this.createMainToolMask()
            }
        )
    }

    async stop() {
        this._toolMaskDispose?.()
        this._toolMaskDispose = undefined
    }

    mergeRule(rule: PermissionRule, fallback: PermissionRule): PermissionRule {
        if (rule.mode !== 'inherit') {
            return {
                mode: rule.mode,
                allow: [...rule.allow],
                deny: [...rule.deny]
            }
        }

        return {
            mode: fallback.mode,
            allow: [...fallback.allow],
            deny: [...fallback.deny]
        }
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

        if (rule.mode === 'allow') {
            return names.filter((name) => rule.allow.includes(name))
        }

        if (rule.mode === 'deny') {
            if (rule.deny.length < 1) {
                return []
            }

            return names.filter((name) => !rule.deny.includes(name))
        }

        return [...names]
    }

    filterComputerBackends(info: SubAgentInfo, names: ComputerBackendType[]) {
        const rule = this.mergeRule(
            info.permissions.computer,
            this.config.subAgent.defaults.computer
        )
        const allow = rule.allow.filter(isComputerBackend)
        const deny = rule.deny.filter(isComputerBackend)

        if (rule.mode === 'allow') {
            if (rule.allow.length < 1) {
                return []
            }

            if (allow.length < 1) {
                return [...names]
            }

            return names.filter((name) => allow.includes(name))
        }

        if (rule.mode === 'deny') {
            if (rule.deny.length < 1) {
                return []
            }

            if (deny.length < 1) {
                return [...names]
            }

            return names.filter((name) => !deny.includes(name))
        }

        return [...names]
    }

    listTools(): ToolInfo[] {
        const registry = this.getRegistry()
        const key = Object.keys(registry).sort().join('\n')
        if (this._toolCache && this._toolCacheKey === key) {
            return this._toolCache
        }

        const list = Object.values(registry)
            .map((item) => {
                const cfg = createToolItemConfig(
                    this.config.tool.items[item.name]
                )
                return {
                    name: item.name,
                    description: item.description,
                    enabled: cfg.enabled,
                    main: cfg.main,
                    subAgents: cfg.subAgents,
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
            source: item.source,
            group: item.group,
            tags: item.tags,
            agents: agents
                .filter((agent) => this.canUseTool(agent, item.name))
                .map((agent) => agent.name)
        }))
    }

    createMainToolMask(): ToolMask {
        const tools = this.listTools()
        const allNames = tools.map((item) => item.name)
        const allow = tools
            .filter((item) => item.enabled && item.main)
            .map((item) => item.name)

        return buildToolMask(allNames, allow)
    }

    createSubAgentToolMask(info: SubAgentInfo): ToolMask {
        const allNames = this.listTools().map((item) => item.name)
        const allow = allNames.filter((name) => this.canUseTool(info, name))
        return buildToolMask(allNames, allow)
    }

    canUseTool(info: SubAgentInfo, name: string): boolean {
        const tool = this.getTool(name)
        if (!tool?.enabled) {
            return false
        }

        if (!matchRule(info.id, tool.subAgents)) {
            return false
        }

        if (
            !matchRule(
                name,
                this.mergeRule(
                    info.permissions.tools,
                    this.config.subAgent.defaults.tools
                )
            )
        ) {
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
            const backends =
                this.ctx.chatluna_agent?.computer.listAvailableBackends() ?? []
            if (this.filterComputerBackends(info, backends).length < 1) {
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
        const registry = this.ctx.chatluna.platform.getToolRegistry()
        return Object.fromEntries(
            Object.values(registry).map((item) => {
                const meta = this.config.tool.registry?.[item.name]
                return [
                    item.name,
                    {
                        name: item.name,
                        description: item.description,
                        meta: {
                            ...item.meta,
                            source: meta?.source ?? item.meta?.source,
                            group: meta?.group ?? item.meta?.group,
                            tags:
                                meta?.tags && meta.tags.length > 0
                                    ? meta.tags
                                    : item.meta?.tags
                        }
                    }
                ]
            })
        )
    }

    private getTool(name: string) {
        this.listTools()
        return this._toolMap?.get(name)
    }
}

function buildToolMask(allNames: string[], allow: string[]): ToolMask {
    if (allow.length >= allNames.length) {
        return { mode: 'all', allow: [], deny: [] }
    }

    const deny = allNames.filter((name) => !allow.includes(name))
    if (allow.length <= deny.length) {
        return { mode: 'allow', allow, deny: [] }
    }

    return { mode: 'deny', allow: [], deny }
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
