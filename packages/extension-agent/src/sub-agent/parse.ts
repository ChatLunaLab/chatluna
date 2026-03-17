/** @module sub-agent/parse */

import { load } from 'js-yaml'
import { PermissionRule, SubAgentPermissionConfig } from '../types'
import { extractFrontmatter } from '../utils/frontmatter'

export interface ParsedAgentFrontmatter {
    format: 'chatluna' | 'claude' | 'opencode'
    name: string
    description: string
    model?: string
    maxTurns?: number
    hidden: boolean
    enabled: boolean
    permissions: SubAgentPermissionConfig
    promptContent: string
    allowKoishiMessageTransform: boolean
    diagnostics: string[]
}

export function parseAgentFrontmatter(
    raw: string,
    fallbackName: string,
    hint?: 'chatluna' | 'claude' | 'opencode'
) {
    const parsed = extractFrontmatter(raw)
    if (!parsed) {
        return {
            state: 'invalid' as const,
            promptContent: raw.trim(),
            diagnostics: ['Agent markdown is missing valid YAML frontmatter']
        }
    }

    let frontmatter: Record<string, unknown>

    try {
        frontmatter =
            (load(parsed.frontmatter) as Record<string, unknown>) ?? {}
    } catch (error) {
        return {
            state: 'invalid' as const,
            promptContent: parsed.body,
            diagnostics: [
                `Failed to parse frontmatter: ${error instanceof Error ? error.message : String(error)}`
            ]
        }
    }

    const format = detectAgentFormat(frontmatter, hint)
    const diagnostics: string[] = []
    const permissions = createPermissionConfig()
    let promptContent = parsed.body
    let enabled = true
    let hidden = false
    let model: string | undefined
    let maxTurns: number | undefined
    let allowKoishiMessageTransform = false

    const name =
        typeof frontmatter.name === 'string' &&
        frontmatter.name.trim().length > 0
            ? frontmatter.name.trim()
            : fallbackName
    const description =
        typeof frontmatter.description === 'string'
            ? frontmatter.description.trim()
            : ''

    if (format === 'claude') {
        applyClaudeFrontmatter(frontmatter, permissions, diagnostics)
        hidden = frontmatter.hidden === true
        model =
            typeof frontmatter.model === 'string'
                ? frontmatter.model
                : undefined
        maxTurns =
            typeof frontmatter.maxTurns === 'number'
                ? frontmatter.maxTurns
                : undefined
    } else if (format === 'opencode') {
        applyOpencodeFrontmatter(frontmatter, permissions, diagnostics)
        hidden = frontmatter.hidden === true
        enabled = frontmatter.disable === true ? false : enabled
        model =
            typeof frontmatter.model === 'string'
                ? frontmatter.model
                : undefined

        if (
            typeof frontmatter.prompt === 'string' &&
            frontmatter.prompt.trim()
        ) {
            promptContent =
                `${frontmatter.prompt.trim()}\n\n${parsed.body}`.trim()
        }

        if (frontmatter.mode != null) {
            diagnostics.push(
                `OpenCode field 'mode' is informational only: ${String(frontmatter.mode)}`
            )
        }

        if (frontmatter.steps != null) {
            diagnostics.push(
                `OpenCode field 'steps' is not mapped and is ignored`
            )
        }
    } else {
        hidden = frontmatter.hidden === true
        enabled = frontmatter.enabled !== false
        model =
            typeof frontmatter.model === 'string'
                ? frontmatter.model
                : undefined
        maxTurns =
            typeof frontmatter.maxTurns === 'number'
                ? frontmatter.maxTurns
                : undefined
        allowKoishiMessageTransform =
            frontmatter.allowKoishiMessageTransform === true

        if (
            typeof frontmatter.permissions === 'object' &&
            frontmatter.permissions != null
        ) {
            const item = frontmatter.permissions as Record<string, unknown>
            permissions.skills = createRule(item.skills, 'inherit')
            permissions.mcp = createRule(item.mcp, 'inherit')
            permissions.tools = createRule(item.tools, 'inherit')
            permissions.computer = createRule(item.computer, 'deny')
        }
    }

    if (description.length < 1) {
        diagnostics.push('Agent description is required')
    }

    if (promptContent.trim().length < 1) {
        diagnostics.push('Agent prompt content is empty')
    }

    return {
        state:
            description.length > 0 && promptContent.trim().length > 0
                ? ('ready' as const)
                : ('invalid' as const),
        value: {
            format,
            name,
            description,
            model,
            maxTurns,
            hidden,
            enabled,
            permissions,
            promptContent,
            allowKoishiMessageTransform,
            diagnostics
        } satisfies ParsedAgentFrontmatter,
        diagnostics
    }
}

function detectAgentFormat(
    frontmatter: Record<string, unknown>,
    hint?: 'chatluna' | 'claude' | 'opencode'
) {
    if (hint) {
        return hint
    }

    if (
        'disallowedTools' in frontmatter ||
        'permissionMode' in frontmatter ||
        'maxTurns' in frontmatter
    ) {
        return 'claude'
    }

    if (
        typeof frontmatter.mode === 'string' &&
        [
            'primary',
            'subagent',
            'all',
            'agent',
            'ask',
            'allow',
            'deny'
        ].includes(frontmatter.mode)
    ) {
        return 'opencode'
    }

    return 'chatluna'
}

function applyClaudeFrontmatter(
    frontmatter: Record<string, unknown>,
    permissions: SubAgentPermissionConfig,
    diagnostics: string[]
) {
    const tools = readNames(frontmatter.tools)
    const disallowed = readNames(frontmatter.disallowedTools)
    const skillNames = readNames(frontmatter.skills)
    const mcpServers = readNames(frontmatter.mcpServers)

    if (tools.length > 0) {
        permissions.tools.mode = 'allow'
        permissions.tools.allow = tools.filter(
            (item) => !disallowed.includes(item)
        )
        permissions.tools.deny = disallowed
    } else if (disallowed.length > 0) {
        permissions.tools.mode = 'deny'
        permissions.tools.deny = disallowed
    }

    if (skillNames.length > 0) {
        permissions.skills.mode = 'allow'
        permissions.skills.allow = skillNames
    }

    if (mcpServers.length > 0) {
        permissions.mcp.mode = 'allow'
        permissions.mcp.allow = mcpServers
    }

    if (frontmatter.permissionMode != null) {
        diagnostics.push(
            `Claude field 'permissionMode' is not mapped directly: ${String(frontmatter.permissionMode)}`
        )
    }
}

function applyOpencodeFrontmatter(
    frontmatter: Record<string, unknown>,
    permissions: SubAgentPermissionConfig,
    diagnostics: string[]
) {
    const tools = readNames(frontmatter.tools)
    if (tools.length > 0) {
        permissions.tools.mode = 'allow'
        permissions.tools.allow = tools
    } else if (
        typeof frontmatter.tools === 'object' &&
        frontmatter.tools != null
    ) {
        const value = frontmatter.tools as Record<string, unknown>
        const allow = Object.entries(value)
            .filter(([, item]) => item === true)
            .flatMap(([key]) => mapCompatToolName(key))
        const deny = Object.entries(value)
            .filter(([, item]) => item === false)
            .flatMap(([key]) => mapCompatToolName(key))

        if (allow.length > 0) {
            permissions.tools.mode = 'allow'
            permissions.tools.allow = Array.from(new Set(allow))
        } else if (deny.length > 0) {
            permissions.tools.mode = 'deny'
            permissions.tools.deny = Array.from(new Set(deny))
        }
    }

    if (
        typeof frontmatter.permission === 'object' &&
        frontmatter.permission != null
    ) {
        const item = frontmatter.permission as Record<string, unknown>
        applyPermissionMode(
            item.edit,
            ['file_write', 'file_edit'],
            permissions.tools
        )
        applyPermissionMode(item.bash, ['bash'], permissions.tools)
        applyPermissionMode(
            item.webfetch,
            ['web_search', 'web_browser'],
            permissions.tools
        )
        applyPermissionMode(item.task, ['task'], permissions.tools)

        if (item.mcp != null) {
            diagnostics.push(
                `OpenCode field 'permission.mcp' is not mapped directly`
            )
        }
    }
}

function applyPermissionMode(
    value: unknown,
    names: string[],
    rule: PermissionRule
) {
    if (value === 'deny') {
        if (rule.mode === 'allow') {
            rule.allow = rule.allow.filter((item) => !names.includes(item))
            return
        }

        rule.mode = 'deny'
        rule.deny = Array.from(new Set([...rule.deny, ...names]))
        return
    }

    if (value === 'allow') {
        rule.mode = 'allow'
        rule.allow = Array.from(new Set([...rule.allow, ...names]))
    }
}

function createPermissionConfig(): SubAgentPermissionConfig {
    return {
        skills: createRule(undefined, 'inherit'),
        mcp: createRule(undefined, 'inherit'),
        tools: createRule(undefined, 'inherit'),
        computer: createRule(undefined, 'deny')
    }
}

function createRule(
    value: unknown,
    fallback: PermissionRule['mode']
): PermissionRule {
    if (typeof value !== 'object' || value == null) {
        return {
            mode: fallback,
            allow: [],
            deny: []
        }
    }

    const item = value as Record<string, unknown>
    return {
        mode:
            item.mode === 'inherit' ||
            item.mode === 'all' ||
            item.mode === 'allow' ||
            item.mode === 'deny'
                ? item.mode
                : fallback,
        allow: readNames(item.allow),
        deny: readNames(item.deny)
    }
}

function readNames(value: unknown) {
    if (typeof value === 'string') {
        return value
            .split(/\s*,\s*|\s+/)
            .map((item) => item.trim())
            .filter(Boolean)
            .flatMap((item) => mapCompatToolName(item))
    }

    if (!Array.isArray(value)) {
        return []
    }

    return value
        .flatMap((item) => {
            if (typeof item === 'string') {
                return item
            }

            if (typeof item === 'object' && item != null) {
                const keys = Object.keys(item as Record<string, unknown>)
                return keys.length > 0 ? keys[0] : []
            }

            return []
        })
        .map((item) => item.trim())
        .filter(Boolean)
        .flatMap((item) => mapCompatToolName(item))
}

function mapCompatToolName(name: string) {
    const lower = name.toLowerCase().replace(/\s+/g, '')

    if (lower === 'read') return ['file_read']
    if (lower === 'write') return ['file_write']
    if (lower === 'edit') return ['file_edit']
    if (lower === 'bash') return ['bash']
    if (lower === 'grep') return ['grep']
    if (lower === 'glob') return ['glob']
    if (lower === 'webfetch') return ['web_search', 'web_browser']
    if (lower === 'task' || lower === 'agent' || lower.startsWith('agent(')) {
        return ['task']
    }

    return [name]
}
