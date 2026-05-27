/** @module sub-agent/parse */

import { load } from 'js-yaml'
import { PermissionRule, SubAgentPermissionConfig } from '../types'
import { extractFrontmatter } from '../utils/frontmatter'

export interface ParsedAgentFrontmatter {
    format: 'chatluna' | 'claude' | 'opencode'
    name: string
    description: string
    chatluna: boolean
    character: boolean
    characterGroup: boolean
    characterPrivate: boolean
    characterGroupMode: 'all' | 'allow' | 'deny'
    characterPrivateMode: 'all' | 'allow' | 'deny'
    characterGroupIds: string[]
    characterPrivateIds: string[]
    authority: number
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

    // Detect format inline
    let format: 'chatluna' | 'claude' | 'opencode'
    if (hint) {
        format = hint
    } else if (
        'disallowedTools' in frontmatter ||
        'permissionMode' in frontmatter ||
        'maxTurns' in frontmatter
    ) {
        format = 'claude'
    } else if (
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
        format = 'opencode'
    } else {
        format = 'chatluna'
    }

    const diagnostics: string[] = []
    const permissions: SubAgentPermissionConfig = {
        skills: createRule(undefined, 'inherit'),
        mcp: createRule(undefined, 'inherit'),
        tools: createRule(undefined, 'inherit'),
        computer: createRule(undefined, 'deny')
    }
    let promptContent = parsed.body
    let enabled = true
    let hidden = false
    let chatluna = true
    let character = true
    let characterGroup = true
    let characterPrivate = true
    let characterGroupMode: 'all' | 'allow' | 'deny' = 'all'
    let characterPrivateMode: 'all' | 'allow' | 'deny' = 'all'
    let characterGroupIds: string[] = []
    let characterPrivateIds: string[] = []
    let authority = 0
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
        const tools = readNames(frontmatter.tools)
        const disallowed = readNames(frontmatter.disallowedTools)
        const skills = readNames(frontmatter.skills)
        const mcpServers = readNames(frontmatter.mcpServers)

        if (tools.length > 0) {
            permissions.tools.mode = 'allow'
            permissions.tools.allow = tools.filter(
                (t) => !disallowed.includes(t)
            )
            permissions.tools.deny = disallowed
        } else if (disallowed.length > 0) {
            permissions.tools.mode = 'deny'
            permissions.tools.deny = disallowed
        }

        if (skills.length > 0) {
            permissions.skills.mode = 'allow'
            permissions.skills.allow = skills
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
        const tools = readNames(frontmatter.tools)
        if (tools.length > 0) {
            permissions.tools.mode = 'allow'
            permissions.tools.allow = tools
        } else if (
            typeof frontmatter.tools === 'object' &&
            frontmatter.tools != null
        ) {
            const obj = frontmatter.tools as Record<string, unknown>
            const allow = Object.entries(obj)
                .filter(([, v]) => v === true)
                .flatMap(([k]) => mapCompatToolName(k))
            const deny = Object.entries(obj)
                .filter(([, v]) => v === false)
                .flatMap(([k]) => mapCompatToolName(k))

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
            const perm = frontmatter.permission as Record<string, unknown>
            applyPermissionMode(
                perm.edit,
                ['file_write', 'file_edit'],
                permissions.tools
            )
            applyPermissionMode(perm.bash, ['bash'], permissions.tools)
            applyPermissionMode(
                perm.webfetch,
                [
                    'web_search',
                    'browser_open',
                    'browser_read_text',
                    'browser_get_html',
                    'browser_get_links',
                    'browser_summarize'
                ],
                permissions.tools
            )
            applyPermissionMode(perm.task, ['task'], permissions.tools)

            if (perm.mcp != null) {
                diagnostics.push(
                    `OpenCode field 'permission.mcp' is not mapped directly`
                )
            }
        }

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
        chatluna = frontmatter.chatluna !== false
        character = frontmatter.character !== false
        characterGroup = frontmatter.characterGroup !== false
        characterPrivate = frontmatter.characterPrivate !== false
        characterGroupMode =
            frontmatter.characterGroupMode === 'allow' ||
            frontmatter.characterGroupMode === 'deny'
                ? frontmatter.characterGroupMode
                : 'all'
        characterPrivateMode =
            frontmatter.characterPrivateMode === 'allow' ||
            frontmatter.characterPrivateMode === 'deny'
                ? frontmatter.characterPrivateMode
                : 'all'
        characterGroupIds = readValues(frontmatter.characterGroupIds)
        characterPrivateIds = readValues(frontmatter.characterPrivateIds)
        authority =
            typeof frontmatter.authority === 'number'
                ? frontmatter.authority
                : 0
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
            const p = frontmatter.permissions as Record<string, unknown>
            permissions.skills = createRule(p.skills, 'inherit')
            permissions.mcp = createRule(p.mcp, 'inherit')
            permissions.tools = createRule(p.tools, 'inherit')
            permissions.computer = createRule(p.computer, 'inherit')
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
            chatluna,
            character,
            characterGroup,
            characterPrivate,
            characterGroupMode,
            characterPrivateMode,
            characterGroupIds,
            characterPrivateIds,
            authority,
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

function createRule(
    value: unknown,
    fallback: PermissionRule['mode']
): PermissionRule {
    if (typeof value !== 'object' || value == null) {
        return { mode: fallback, allow: [], deny: [] }
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
            .map((s) => s.trim())
            .filter(Boolean)
            .flatMap((s) => mapCompatToolName(s))
    }

    if (!Array.isArray(value)) return []

    return value
        .flatMap((item) => {
            if (typeof item === 'string') return item
            if (typeof item === 'object' && item != null) {
                const keys = Object.keys(item as Record<string, unknown>)
                return keys.length > 0 ? keys[0] : []
            }
            return []
        })
        .map((s) => s.trim())
        .filter(Boolean)
        .flatMap((s) => mapCompatToolName(s))
}

function readValues(value: unknown) {
    if (typeof value === 'string') {
        return value
            .split(/\s*,\s*|\s+/)
            .map((s) => s.trim())
            .filter(Boolean)
    }

    if (!Array.isArray(value)) return []

    return value
        .filter((item): item is string => typeof item === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
}

const COMPAT_TOOL_MAP: Record<string, string[]> = {
    read: ['file_read'],
    write: ['file_write'],
    edit: ['file_edit'],
    bash: ['bash'],
    grep: ['grep'],
    glob: ['glob'],
    webfetch: [
        'web_search',
        'browser_open',
        'browser_read_text',
        'browser_get_html',
        'browser_get_links',
        'browser_summarize'
    ],
    task: ['task'],
    agent: ['task']
}

function mapCompatToolName(name: string) {
    const lower = name.toLowerCase().replace(/\s+/g, '')
    if (lower.startsWith('agent(')) return ['task']
    return COMPAT_TOOL_MAP[lower] ?? [name]
}
