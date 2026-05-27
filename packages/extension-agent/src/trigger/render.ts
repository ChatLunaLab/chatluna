/** @module trigger/render */

import { SystemMessage } from '@langchain/core/messages'
import { z, type ZodTypeAny } from 'zod'
import type { TriggerProvider, TriggerTask } from '../types'

export function renderTriggerProviders(providers: TriggerProvider[]) {
    const lines: string[] = []

    lines.push(
        '<trigger_tool>',
        'Use the trigger tool to manage all scheduled or passive trigger tasks.',
        '',
        'Call it with one field: cmd = a single DSL statement.',
        'Syntax: verb(positional, ..., key=value, ...). Strings use double quotes.',
        '',
        'Examples:',
        '  list()',
        '  get(42)',
        '  create(cron, message="Check updates", reply=channel, mode=chain, expression="*/10 8-9 * * *", missed=skip)',
        '  create(cron, guild_id="123456", message="Check updates", scope=all, reply=channel, expression="0 9 * * *")',
        '  create(once, message="Good morning", reply=channel, fire_at="2026-04-25T08:00:00+08:00")',
        '  disable(42)',
        '  disable(42, 43)',
        '  enable(42)',
        '  remove(42)',
        '  fire(42)',
        '  snooze(2h)',
        '  snooze_until("2026-04-25T08:00:00+08:00")',
        '',
        'Common create fields:',
        '  name=, message=, reply=channel|user|silent, mode=chain|direct,',
        '  scope=all|personal, new_conv=true|false.',
        'Target override fields for create:',
        '  platform=, self_id=, user_id=, username=, guild_id=, channel_id=, direct=true|false.',
        '  Omitted target fields default to the current chat. When guild_id or channel_id is set, direct defaults to false.',
        'Provider params are named args. Aliases: missed=skip|fire_once, fire_at=ISO.',
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

export function renderTriggerSelfControl(task: TriggerTask, now: Date) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const lines = [
        '<trigger_self_control>',
        `This run was triggered by task #${task.id}.`,
        `  provider: ${task.providerKind}`,
        ...(task.params?.expression != null
            ? [`  expression: ${task.params.expression}`]
            : []),
        `  now: ${now.toISOString()} (${zone})`,
        '',
        'To control this task, call tool "trigger". Omit taskId to target this task:',
        '  snooze(<duration>)                 e.g. snooze(2h)',
        '  snooze_until("<ISO>")              e.g. snooze_until("2026-04-25T08:00:00+08:00")',
        '  disable()',
        '',
        'You decide when the next fire should happen.',
        'If this cron task should resume only at a later cron occurrence, compute that ISO and call snooze_until("<ISO>").',
        '',
        'Only call when you actually want to change the schedule.',
        '</trigger_self_control>'
    ]

    return new SystemMessage(lines.join('\n'))
}

export function zodToTsSignature(schema?: ZodTypeAny): string {
    if (schema == null) return 'Record<string, unknown>'
    return renderType(schema, 1)
}

function renderType(schema: ZodTypeAny, indent: number): string {
    const def = schema._def
    const name = def?.typeName as string | undefined

    if (name === 'ZodOptional') {
        return renderType(def.innerType, indent)
    }
    if (name === 'ZodNullable') {
        return `${renderType(def.innerType, indent)} | null`
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
            const typeName = value._def?.typeName as string | undefined
            const optional =
                typeName === 'ZodOptional' || typeName === 'ZodDefault'
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
