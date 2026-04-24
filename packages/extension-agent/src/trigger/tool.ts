import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import {
    getBaseBindingKey,
    getPresetLane
} from 'koishi-plugin-chatluna/services/chat'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type { ChatLunaAgentTriggerService } from '../service/trigger'
import type { TriggerTask } from '../types'
import {
    type DslCall,
    type DslValue,
    parseDsl,
    valueToDurationMs,
    valueToNumber,
    valueToString
} from './dsl'

export class TriggerTool extends StructuredTool {
    name = 'trigger'

    description =
        'Manage scheduled or passive trigger tasks for the current chat. ' +
        'Input is a single DSL statement in cmd. See <trigger_tool> and <trigger_providers>.'

    schema = z.object({
        cmd: z
            .string()
            .describe('Single trigger DSL statement. See <trigger_tool>.')
    })

    constructor(private readonly service: ChatLunaAgentTriggerService) {
        super({})
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        config: ChatLunaToolRunnable
    ) {
        let call: DslCall
        try {
            call = parseDsl(input.cmd)
        } catch (err) {
            return err instanceof Error ? err.message : String(err)
        }

        try {
            const session = config.configurable.session
            const requestId = (
                config.configurable as {
                    agentContext?: { requestId?: string }
                }
            ).agentContext?.requestId
            const runningTaskId = this.service.getRunningTaskId(requestId)
            const resolved =
                await this.service.ctx.chatluna.conversation.resolveConstraint(
                    session
                )
            const baseKey = getBaseBindingKey(resolved.bindingKey)
            const ownsTask = (task: {
                bindingKey: string
                createdBy: string
            }) =>
                (task.bindingKey === resolved.bindingKey ||
                    task.bindingKey === baseKey) &&
                task.createdBy === session.userId

            if (call.verb === 'list') {
                const tasks = (await this.service.listTasks()).filter(ownsTask)
                if (tasks.length < 1) {
                    return 'No trigger tasks found for this chat.'
                }

                return JSON.stringify(tasks.map(formatTask))
            }

            if (call.verb === 'get') {
                if (call.positional.length < 1)
                    return 'taskId is required for get.'
                const tasks = await this._getOwnedTasks(
                    call.positional.map(valueToNumber),
                    ownsTask
                )
                if (typeof tasks === 'string') return tasks
                const result = tasks.map(formatTask)
                return JSON.stringify(result.length === 1 ? result[0] : result)
            }

            if (call.verb === 'enable') {
                if (
                    runningTaskId != null &&
                    !this.service.canMutateRunningTask(requestId)
                ) {
                    return 'ignored: manual fire mode'
                }
                if (call.positional.length < 1) {
                    return 'taskId is required for enable.'
                }
                return await this._setEnabled(
                    call.positional.map(valueToNumber),
                    true,
                    ownsTask
                )
            }

            if (call.verb === 'disable') {
                if (
                    runningTaskId != null &&
                    !this.service.canMutateRunningTask(requestId)
                ) {
                    return 'ignored: manual fire mode'
                }
                const ids =
                    call.positional.length > 0
                        ? call.positional.map(valueToNumber)
                        : runningTaskId == null
                          ? []
                          : [runningTaskId]
                if (ids.length < 1) {
                    return 'taskId is required for disable outside a trigger run.'
                }
                return await this._setEnabled(ids, false, ownsTask)
            }

            if (call.verb === 'fire') {
                if (call.positional.length < 1) {
                    return 'taskId is required for fire.'
                }
                const tasks = await this._getOwnedTasks(
                    call.positional.map(valueToNumber),
                    ownsTask
                )
                if (typeof tasks === 'string') return tasks

                const results = []
                for (const task of tasks) {
                    results.push(await this.service.fire(task.id, session))
                }
                return JSON.stringify(
                    results.length === 1 ? results[0] : results
                )
            }

            if (call.verb === 'cancel' || call.verb === 'remove') {
                if (call.positional.length < 1) {
                    return 'taskId is required for remove.'
                }
                const ids = call.positional.map(valueToNumber)
                const tasks = await this._getOwnedTasks(ids, ownsTask)
                if (typeof tasks === 'string') return tasks

                for (const id of ids) {
                    await this.service.removeTask(id)
                }
                return `Trigger task ${ids.join(', ')} removed.`
            }

            if (call.verb === 'snooze') {
                if (
                    runningTaskId != null &&
                    !this.service.canMutateRunningTask(requestId)
                ) {
                    return 'ignored: manual fire mode'
                }
                if (call.positional.length < 1)
                    return 'duration is required for snooze.'
                return await this._snooze(
                    call.positional.length > 1
                        ? call.positional.slice(1).map(valueToNumber)
                        : runningTaskId == null
                          ? []
                          : [runningTaskId],
                    new Date(
                        Date.now() + valueToDurationMs(call.positional[0])
                    ),
                    ownsTask
                )
            }

            if (call.verb === 'snooze_until') {
                if (
                    runningTaskId != null &&
                    !this.service.canMutateRunningTask(requestId)
                ) {
                    return 'ignored: manual fire mode'
                }
                if (call.positional.length < 1) {
                    return 'ISO date is required for snooze_until.'
                }
                return await this._snooze(
                    call.positional.length > 1
                        ? call.positional.slice(1).map(valueToNumber)
                        : runningTaskId == null
                          ? []
                          : [runningTaskId],
                    new Date(valueToString(call.positional[0])),
                    ownsTask
                )
            }

            if (call.verb !== 'create') {
                return `Unknown trigger command: ${call.verb}.`
            }

            if (call.positional.length < 1) {
                return 'provider kind is required for create.'
            }

            const providerKind = valueToString(call.positional[0])
            const provider = this.service
                .getProviders()
                .find((p) => p.kind === providerKind)
            if (provider == null) {
                return `Unknown providerKind: ${providerKind}. See <trigger_providers> in the system prompt.`
            }

            const message =
                call.named.message == null
                    ? undefined
                    : valueToString(call.named.message)
            if (
                provider.needsMessage &&
                (message == null || message.trim().length < 1)
            ) {
                return `message is required for provider ${provider.kind}.`
            }

            let useAllScope = false
            if (call.named.scope != null) {
                const value = valueToString(call.named.scope)
                if (value !== 'all' && value !== 'personal') {
                    return `Invalid scope: ${value}. Expected all or personal.`
                }
                useAllScope = value === 'all'
            }
            const bindingKey = useAllScope
                ? getBaseBindingKey(resolved.bindingKey)
                : resolved.bindingKey
            const presetLane = useAllScope
                ? null
                : (resolved.activePresetLane ??
                  getPresetLane(resolved.bindingKey))
            const params: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(call.named)) {
                if (
                    key === 'message' ||
                    key === 'reply' ||
                    key === 'mode' ||
                    key === 'name' ||
                    key === 'scope' ||
                    key === 'new_conv'
                ) {
                    continue
                }
                params[
                    key === 'missed'
                        ? 'missedRunPolicy'
                        : key === 'fire_at'
                          ? 'fireAt'
                          : key
                ] = rawValue(value)
            }

            let replyTo: 'channel' | 'user' | 'silent' | undefined
            if (call.named.reply != null) {
                const value = valueToString(call.named.reply)
                if (
                    value !== 'channel' &&
                    value !== 'user' &&
                    value !== 'silent'
                ) {
                    return `Invalid reply: ${value}. Expected channel, user, or silent.`
                }
                replyTo = value
            }

            let execMode: 'chain' | 'direct' | undefined
            if (call.named.mode != null) {
                const value = valueToString(call.named.mode)
                if (value !== 'chain' && value !== 'direct') {
                    return `Invalid mode: ${value}. Expected chain or direct.`
                }
                execMode = value
            }

            let newConversation = true
            if (call.named.new_conv != null) {
                if (typeof call.named.new_conv !== 'boolean') {
                    return 'Invalid new_conv: expected true or false.'
                }
                newConversation = call.named.new_conv
            }

            const task = await this.service.createTask(session, {
                providerKind,
                name:
                    call.named.name == null
                        ? undefined
                        : valueToString(call.named.name),
                presetLane,
                scope: useAllScope ? 'shared' : 'personal',
                bindingKey,
                params,
                createdBy: session.userId,
                source: 'agent',
                wakeupTemplate: {
                    message,
                    replyTo,
                    execMode,
                    newConversation
                }
            })

            return JSON.stringify(formatTask(task))
        } catch (err) {
            return err instanceof Error ? err.message : String(err)
        }
    }

    private async _setEnabled(
        ids: number[],
        enabled: boolean,
        ownsTask: (task: { bindingKey: string; createdBy: string }) => boolean
    ) {
        const tasks = await this._getOwnedTasks(ids, ownsTask)
        if (typeof tasks === 'string') return tasks

        for (const id of ids) {
            await this.service.setEnabled(id, enabled)
        }
        return `Trigger task ${ids.join(', ')} ${enabled ? 'enabled' : 'disabled'}.`
    }

    private async _snooze(
        ids: number[],
        after: Date,
        ownsTask: (task: { bindingKey: string; createdBy: string }) => boolean
    ) {
        if (ids.length < 1) {
            return 'taskId is required for snooze outside a trigger run.'
        }
        if (Number.isNaN(after.valueOf())) return 'Invalid snooze date.'

        const tasks = await this._getOwnedTasks(ids, ownsTask)
        if (typeof tasks === 'string') return tasks

        const result = []
        for (const id of ids) {
            result.push(formatTask(await this.service.snoozeTask(id, after)))
        }
        return JSON.stringify(result.length === 1 ? result[0] : result)
    }

    private async _getOwnedTasks(
        ids: number[],
        ownsTask: (task: { bindingKey: string; createdBy: string }) => boolean
    ) {
        const tasks: TriggerTask[] = []
        for (const id of ids) {
            const task = await this.service.getTask(id)
            if (task == null || !ownsTask(task)) {
                return `Trigger task ${id} not found.`
            }
            tasks.push(task)
        }
        return tasks
    }
}

function formatTask(task: {
    id: number
    name?: string | null
    providerKind: string | null
    enabled: boolean
    nextFireAt?: Date | null
    params?: Record<string, unknown> | null
}) {
    return {
        id: task.id,
        name: task.name,
        providerKind: task.providerKind,
        enabled: task.enabled,
        nextFireAt: task.nextFireAt,
        params: task.params
    }
}

function rawValue(value: DslValue): unknown {
    if (typeof value !== 'object') return value
    if (value.kind === 'duration') return value.ms
    return value.name
}
