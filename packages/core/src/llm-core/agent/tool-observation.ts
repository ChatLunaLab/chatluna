import { isDirectToolOutput } from '@langchain/core/messages/tool'
import {
    StructuredTool,
    ToolInputParsingException
} from '@langchain/core/tools'
import { logger } from 'koishi-plugin-chatluna'
import {
    isMessageContentComplex,
    isMessageContentText
} from 'koishi-plugin-chatluna/utils/langchain'
import { z } from 'zod'
import { AgentAction, AgentObservation } from './types'

export interface AgentLoopState {
    calls: Map<string, number>
    failures: Map<string, number>
    results: Map<string, { hash: string; count: number }>
    busy: Map<string, number>
}

export function createAgentLoopState(): AgentLoopState {
    return {
        calls: new Map(),
        failures: new Map(),
        results: new Map(),
        busy: new Map()
    }
}

export function repairToolAction(
    action: AgentAction,
    tools: Record<string, StructuredTool>
): AgentAction {
    const tool = findTool(action.tool, tools)
    if (!tool) return action

    const input = repairToolInput(tool, action.toolInput)
    if (tool.name === action.tool && input === action.toolInput) return action

    logger.debug(
        `Repaired tool call '${action.tool}' -> '${tool.name}'`,
        action.toolInput,
        input
    )

    return Object.assign({}, action, {
        tool: tool.name,
        toolInput: input
    })
}

export function applyLoopGuidance(
    state: AgentLoopState | undefined,
    action: AgentAction,
    observation: AgentObservation,
    failed: boolean
) {
    if (!state || isDirectToolOutput(observation)) return observation

    const tool = action.tool?.toLowerCase() ?? ''
    const text = toOutput(observation)
    const failure = failed
    const hints: string[] = []

    if (failure) {
        const count = (state.failures.get(tool) ?? 0) + 1
        state.failures.set(tool, count)

        if (count >= 3) {
            hints.push(
                `Tool '${action.tool}' has failed ${count} times. Inspect ` +
                    'the latest error, run one small diagnostic if needed, ' +
                    'then change tool/arguments or summarize the blocker.'
            )
        }
    } else {
        state.failures.delete(tool)
    }

    if (isNoProgressTool(tool)) {
        const hash = text.slice(0, 4000)
        const prev = state.results.get(tool)
        const count = prev?.hash === hash ? prev.count + 1 : 1
        state.results.set(tool, { hash, count })

        if (count >= 2) {
            hints.push(
                `Tool '${action.tool}' returned the same result ${count} ` +
                    'times. Use the result already available, change the ' +
                    'query/path/command, or finish with what is known.'
            )
        }
    }

    if (isBusyTool(tool)) {
        const count = (state.busy.get(tool) ?? 0) + 1
        state.busy.clear()
        state.busy.set(tool, count)

        if (count >= 3) {
            hints.push(
                `Tool '${action.tool}' has been used ${count} times ` +
                    'in a row. Before calling it again, restate the ' +
                    'current goal, what changed since the last call, and ' +
                    'why another call will make progress.'
            )
        }
    } else {
        state.busy.clear()
    }

    if (hints.length < 1) return observation

    return appendObservation(observation, hints.join('\n'))
}

export function coerceToAgentObservation(
    observation: unknown,
    toolName?: string
): AgentObservation {
    if (typeof observation === 'string' || isDirectToolOutput(observation)) {
        return observation
    }

    if (Array.isArray(observation)) {
        if (observation.every(isMessageContentText)) {
            return observation.map((item) => item.text).join('')
        }

        if (observation.every((item) => isMessageContentComplex(item))) {
            return observation as AgentObservation
        }
    }

    logger.warn(
        `Tool ${toolName ?? 'unknown'} returned unsupported observation type`,
        observation
    )

    try {
        return JSON.stringify(observation) ?? String(observation)
    } catch {
        return String(observation)
    }
}

export function toToolInputErrorObservation(
    handleParsingErrors: boolean | string | ((e: Error) => string),
    error: ToolInputParsingException
): AgentObservation {
    if (handleParsingErrors === true || handleParsingErrors === false) {
        return (
            `Invalid or incomplete tool input: ${error.message} ` +
            `${error.output}. Do not retry with the same invalid input. ` +
            'Change the arguments, use a different tool, or finish with ' +
            'a blocker summary.'
        )
    }

    if (typeof handleParsingErrors === 'string') {
        return handleParsingErrors
    }

    return handleParsingErrors(error)
}

export function toOutput(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }

    if (Array.isArray(value) && value.every(isMessageContentText)) {
        return value.map((item) => item.text).join('')
    }

    try {
        return JSON.stringify(value) ?? String(value)
    } catch {
        return String(value)
    }
}

export function observationToMessageContent(observation: AgentObservation) {
    return isDirectToolOutput(observation) ? '' : observation
}

function findTool(
    name: string | undefined | null,
    tools: Record<string, StructuredTool>
) {
    if (!name) return undefined

    const direct = tools[name.toLowerCase()]
    if (direct) return direct

    const value = name
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
    const bare = value.replace(/[_-]?tool$/, '')
    const found = Object.values(tools).filter((tool) => {
        const key = tool.name.toLowerCase().replace(/[\s-]+/g, '_')
        return (
            key === value ||
            key === bare ||
            key.replace(/[_-]?tool$/, '') === bare
        )
    })

    return found.length === 1 ? found[0] : undefined
}

function repairToolInput(
    tool: StructuredTool,
    input: AgentAction['toolInput']
) {
    const schema = tool.schema as z.ZodTypeAny | undefined
    if (typeof schema?.safeParse !== 'function') return input

    if (!schema.safeParse(input).success) {
        const value = parseToolInput(input)
        if (schema.safeParse(value).success) return value

        const obj = getObjectSchema(schema)
        if (!obj || typeof value !== 'object' || value == null) return input
        if (Array.isArray(value)) return input

        const fixed = Object.fromEntries(
            Object.entries(value).map(([key, val]) => [
                key,
                repairValue(obj.shape[key], val)
            ])
        )

        if (schema.safeParse(fixed).success) return fixed
    }

    return input
}

function parseToolInput(input: AgentAction['toolInput']) {
    if (typeof input !== 'string') return input

    const text = input.trim()
    if (!text) return {}

    try {
        return JSON.parse(text)
    } catch {
        return input
    }
}

function getObjectSchema(schema?: z.ZodTypeAny): z.AnyZodObject | undefined {
    if (schema instanceof z.ZodObject) return schema
    if (schema instanceof z.ZodEffects)
        return getObjectSchema(schema.innerType())
    return undefined
}

function repairValue(schema: z.ZodTypeAny | undefined, value: unknown) {
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
        return repairValue(schema.unwrap(), value)
    }

    if (schema instanceof z.ZodDefault) {
        return repairValue(schema.removeDefault(), value)
    }

    if (schema instanceof z.ZodEffects) {
        return repairValue(schema.innerType(), value)
    }

    if (schema instanceof z.ZodNumber && typeof value === 'string') {
        const num = Number(value)
        return Number.isNaN(num) ? value : num
    }

    if (schema instanceof z.ZodBoolean && typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true
        if (value.toLowerCase() === 'false') return false
    }

    if (
        schema instanceof z.ZodString &&
        (typeof value === 'number' || typeof value === 'boolean')
    ) {
        return String(value)
    }

    if (schema instanceof z.ZodArray && !Array.isArray(value)) {
        return schema.element.safeParse(value).success ? [value] : value
    }

    if (schema instanceof z.ZodObject && typeof value === 'string') {
        try {
            return JSON.parse(value)
        } catch {
            return value
        }
    }

    return value
}

function appendObservation(observation: AgentObservation, text: string) {
    const hint = `\n\n[Tool loop guidance: ${text}]`
    if (typeof observation === 'string') return observation + hint

    if (Array.isArray(observation) && observation.every(isMessageContentText)) {
        return [
            ...observation,
            {
                type: 'text' as const,
                text: hint
            }
        ]
    }

    return observation
}

function isNoProgressTool(tool: string) {
    return (
        tool === 'grep' ||
        tool === 'glob' ||
        tool === 'file_read' ||
        tool === 'bash' ||
        tool.includes('search') ||
        tool.includes('get') ||
        tool.includes('run') ||
        tool.includes('msg') ||
        tool.includes('send') ||
        tool.includes('read') ||
        tool.includes('list') ||
        tool.includes('status') ||
        tool.includes('mcp')
    )
}

function isBusyTool(tool: string) {
    return (
        tool === 'bash' ||
        tool.includes('mcp') ||
        tool.includes('search') ||
        tool.includes('reply')
    )
}
