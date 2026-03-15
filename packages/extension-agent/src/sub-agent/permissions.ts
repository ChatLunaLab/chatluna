import { ToolMask } from 'koishi-plugin-chatluna/llm-core/agent'
import {
    PermissionRule,
    SubAgentInfo,
    SubAgentPermissionConfig
} from '../types'
import { WRITE_TOOL_PATTERNS } from './scan'

export function mergeRule(
    rule: PermissionRule,
    fallback: PermissionRule
): PermissionRule {
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

export function mergePermissions(
    rules: SubAgentPermissionConfig,
    defaults: SubAgentPermissionConfig
): SubAgentPermissionConfig {
    return {
        skills: mergeRule(rules.skills, defaults.skills),
        mcp: mergeRule(rules.mcp, defaults.mcp),
        tools: mergeRule(rules.tools, defaults.tools),
        computer: mergeRule(rules.computer, defaults.computer)
    }
}

export function filterNames(names: string[], rule: PermissionRule): string[] {
    if (rule.mode === 'allow') {
        return names.filter((name) => rule.allow.includes(name))
    }

    if (rule.mode === 'deny') {
        return names.filter((name) => !rule.deny.includes(name))
    }

    return [...names]
}

export function filterMcpTools(
    registry: Record<
        string,
        { name: string; meta?: { serverName?: string; isMcp?: boolean } }
    >,
    rule: PermissionRule
): string[] {
    const entries = Object.values(registry).filter((item) => item.meta?.isMcp)

    if (rule.mode === 'allow') {
        return entries
            .filter((item) => rule.allow.includes(item.meta!.serverName ?? ''))
            .map((item) => item.name)
    }

    if (rule.mode === 'deny') {
        return entries
            .filter((item) => !rule.deny.includes(item.meta!.serverName ?? ''))
            .map((item) => item.name)
    }

    return entries.map((item) => item.name)
}

export function isWriteTool(name: string): boolean {
    return WRITE_TOOL_PATTERNS.some((pattern) =>
        pattern.endsWith('_') ? name.startsWith(pattern) : name === pattern
    )
}

export function createToolMask(
    info: SubAgentInfo,
    registry: Record<
        string,
        { name: string; meta?: { serverName?: string; isMcp?: boolean } }
    >
): ToolMask {
    const allNames = Object.keys(registry)
    let allow =
        info.permissions.tools.mode === 'inherit' ||
        info.permissions.tools.mode === 'all'
            ? [...allNames]
            : filterNames(allNames, info.permissions.tools)

    const mcpNames = Object.values(registry)
        .filter((item) => item.meta?.isMcp)
        .map((item) => item.name)
    const allowedMcp = filterMcpTools(registry, info.permissions.mcp)

    allow = allow.filter(
        (name) => !mcpNames.includes(name) || allowedMcp.includes(name)
    )

    if (info.name === 'plan' || info.name === 'explore') {
        allow = allow.filter((name) => !isWriteTool(name))
    }

    allow = allow.filter((name) => name !== 'task')

    if (allow.length === allNames.length) {
        return { mode: 'all', allow: [], deny: [] }
    }

    return { mode: 'allow', allow, deny: [] }
}
