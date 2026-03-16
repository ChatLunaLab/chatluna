import { ToolMask } from 'koishi-plugin-chatluna/llm-core/agent'
import { Context } from 'koishi'
import { createPermissionRule, createToolItemConfig } from '../config/defaults'
import {
    AgentConfig,
    PermissionRule,
    SubAgentInfo,
    SubAgentPermissionConfig,
    ToolAvailabilityInfo,
    ToolInfo,
    ToolStatus
} from '../types'
import { WRITE_TOOL_PATTERNS } from '../sub-agent/scan'

export const TOOL_MASK_KEY = '__chatluna_agent_tool_mask'

export class ChatLunaAgentPermissionService {
    private _beforeChatDispose?: () => void

    constructor(
        public ctx: Context,
        public config: AgentConfig
    ) {}

    async start() {
        this._beforeChatDispose = this.ctx.on(
            'chatluna/before-chat',
            async (_, __, vars) => {
                vars[TOOL_MASK_KEY] = this.createMainToolMask()
            }
        )
    }

    async stop() {
        this._beforeChatDispose?.()
        this._beforeChatDispose = undefined
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

    filterNames(names: string[], rule: PermissionRule): string[] {
        if (rule.mode === 'allow') {
            return names.filter((name) => rule.allow.includes(name))
        }

        if (rule.mode === 'deny') {
            return names.filter((name) => !rule.deny.includes(name))
        }

        return [...names]
    }

    filterSkillNames(info: SubAgentInfo, names: string[]) {
        return this.filterNames(
            names,
            this.mergeRule(
                info.permissions.skills,
                this.config.subAgent.defaults.skills
            )
        )
    }

    listTools(): ToolInfo[] {
        const registry = this.getRegistry()
        return Object.values(registry)
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
        const allNames = this.listTools().map((item) => item.name)
        const allow = this.listTools()
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
        const tool = this.listTools().find((item) => item.name === name)
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

export function readToolMask(vars: Record<string, unknown>) {
    return vars[TOOL_MASK_KEY] as ToolMask | undefined
}

export function createToolRule() {
    return createPermissionRule('all')
}
