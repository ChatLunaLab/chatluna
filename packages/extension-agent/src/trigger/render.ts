/** @module trigger/render */

import { SystemMessage } from '@langchain/core/messages'
import { z, type ZodTypeAny } from 'zod'
import type { TriggerProvider } from '../types'

export function renderTriggerProviders(providers: TriggerProvider[]) {
    const lines: string[] = []

    lines.push(
        '<trigger_tool>',
        'Use the trigger tool to manage scheduled or passive trigger tasks for the current chat and current user.',
        '',
        'Actions (pass via the `action` field):',
        '  list                            list your trigger tasks for this chat',
        '  create + providerKind + params  create a provider-backed task',
        '  enable  + taskId                enable one of your tasks',
        '  disable + taskId                disable one of your tasks',
        '  cancel  + taskId                remove one of your tasks (alias of remove)',
        '  remove  + taskId                remove one of your tasks',
        '  fire    + taskId                run one immediately without changing its schedule',
        '',
        'Common create fields:',
        '  name?, message?, replyTo? ("channel" | "user" | "silent"),',
        '  execMode? ("chain"), nextFireAt? (ISO string),',
        '  params (provider-specific, see <trigger_providers>).',
        '`message` is required when the chosen provider is marked "requires message" below.',
        '</trigger_tool>'
    )

    if (providers.length > 0) {
        lines.push('', '<trigger_providers>')
        for (const provider of providers) {
            const modes: string[] = []
            if (provider.scheduled) modes.push('scheduled')
            if (provider.passive) modes.push('passive')
            if (provider.needsMessage) modes.push('requires message')

            lines.push(
                `Provider: ${provider.kind}  (${provider.name})`,
                `  Description: ${provider.description}`,
                ...(modes.length > 0 ? [`  Mode: ${modes.join(', ')}`] : []),
                `  params: ${zodToTsSignature(provider.schema)}`,
                ''
            )
        }
        lines.push('</trigger_providers>')
    }

    return new SystemMessage(lines.join('\n'))
}

export function zodToTsSignature(schema?: ZodTypeAny): string {
    if (schema == null) return 'Record<string, unknown>'
    return renderType(schema, 1)
}

function renderType(schema: ZodTypeAny, indent: number): string {
    const def = schema._def
    const name = def?.typeName as string | undefined

    if (name === 'ZodOptional' || name === 'ZodNullable') {
        return renderType(def.innerType, indent)
    }
    if (name === 'ZodDefault') {
        return renderType(def.innerType, indent)
    }
    if (name === 'ZodEffects') {
        return renderType(def.schema, indent)
    }
    if (name === 'ZodObject') {
        const shape = (schema as z.AnyZodObject).shape as Record<
            string,
            ZodTypeAny
        >
        const pad = '  '.repeat(indent)
        const closePad = '  '.repeat(indent - 1)
        const entries = Object.entries(shape).map(([key, value]) => {
            const optional = isOptional(value)
            const desc = value.description
                ? `  // ${value.description.replaceAll('\n', ' ')}`
                : ''
            return `${pad}${key}${optional ? '?' : ''}: ${renderType(value, indent + 1)}${desc}`
        })
        if (entries.length < 1) return '{}'
        return `{\n${entries.join('\n')}\n${closePad}}`
    }
    if (name === 'ZodArray') {
        return `${renderType(def.type, indent)}[]`
    }
    if (name === 'ZodUnion' || name === 'ZodDiscriminatedUnion') {
        const options = (def.options as ZodTypeAny[]).map((o) =>
            renderType(o, indent)
        )
        return options.join(' | ')
    }
    if (name === 'ZodEnum') {
        return (def.values as string[]).map((v) => `'${v}'`).join(' | ')
    }
    if (name === 'ZodLiteral') {
        const v = def.value
        return typeof v === 'string' ? `'${v}'` : String(v)
    }
    if (name === 'ZodString') return 'string'
    if (name === 'ZodNumber') return 'number'
    if (name === 'ZodBoolean') return 'boolean'
    if (name === 'ZodDate') return 'Date'
    if (name === 'ZodAny' || name === 'ZodUnknown') return 'unknown'
    if (name === 'ZodRecord') return 'Record<string, unknown>'
    if (name === 'ZodTuple') {
        const items = (def.items as ZodTypeAny[]).map((o) =>
            renderType(o, indent)
        )
        return `[${items.join(', ')}]`
    }
    return 'unknown'
}

function isOptional(schema: ZodTypeAny): boolean {
    const name = schema._def?.typeName as string | undefined
    if (name === 'ZodOptional' || name === 'ZodDefault') return true
    if (name === 'ZodNullable') return isOptional(schema._def.innerType)
    return false
}
