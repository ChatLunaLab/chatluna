import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import type { Session } from 'koishi'
import {
    getBaseBindingKey,
    getPresetLane
} from 'koishi-plugin-chatluna/services/chat'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type { ChatLunaAgentTriggerService } from '../service/trigger'
import {
    bindingKeyFromRouting,
    type TriggerTask,
    type WakeupRouting
} from '../types'
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
        'Manage scheduled or passive trigger tasks. ' +
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

            if (call.verb === 'list') {
                const tasks = await this.service.listTasks()
                if (tasks.length < 1) {
                    return 'No trigger tasks found.'
                }

                return JSON.stringify(tasks.map(formatTask))
            }

            if (call.verb === 'get') {
                if (call.positional.length < 1)
                    return 'taskId is required for get.'
                const tasks = await this._getTasks(
                    call.positional.map(valueToNumber)
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
                    true
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
                return await this._setEnabled(ids, false)
            }

            if (call.verb === 'fire') {
                if (call.positional.length < 1) {
                    return 'taskId is required for fire.'
                }
                const tasks = await this._getTasks(
                    call.positional.map(valueToNumber)
                )
                if (typeof tasks === 'string') return tasks

                const results = []
                for (const task of tasks) {
                    results.push(await this.service.fire(task.id))
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
                const tasks = await this._getTasks(ids)
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
                    new Date(Date.now() + valueToDurationMs(call.positional[0]))
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
                    new Date(valueToString(call.positional[0]))
                )
            }

            if (call.verb !== 'create') {
                return `Unknown trigger command: ${call.verb}.`
            }

            if (call.positional.length < 1) {
                return 'provider kind is required for create.'
            }

            const named = call.named
            const providerKind = valueToString(call.positional[0])
            const provider = this.service
                .getProviders()
                .find((p) => p.kind === providerKind)
            if (provider == null) {
                return `Unknown providerKind: ${providerKind}. See <trigger_providers> in the system prompt.`
            }

            const message =
                named.message == null ? undefined : valueToString(named.message)
            if (
                provider.needsMessage &&
                (message == null || message.trim().length < 1)
            ) {
                return `message is required for provider ${provider.kind}.`
            }

            const scope =
                named.scope == null ? 'personal' : valueToString(named.scope)
            if (scope !== 'all' && scope !== 'personal') {
                return `Invalid scope: ${scope}. Expected all or personal.`
            }
            const useAllScope = scope === 'all'
            const direct =
                typeof named.direct === 'boolean' ? named.direct : undefined
            if (named.direct != null && direct == null) {
                return 'Invalid direct: expected true or false.'
            }
            const target = buildRouting(session, named, direct)
            const current =
                await this.service.ctx.chatluna.conversation.resolveConstraint(
                    session
                )
            const bindingKey = target.targetsOtherChat
                ? bindingKeyFromRouting(
                      target.routing,
                      useAllScope ? 'shared' : 'personal'
                  )
                : useAllScope
                  ? getBaseBindingKey(current.bindingKey)
                  : current.bindingKey
            const presetLane =
                useAllScope || target.targetsOtherChat
                    ? null
                    : (current.activePresetLane ?? getPresetLane(bindingKey))
            const params: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(named)) {
                if (
                    key === 'message' ||
                    key === 'reply' ||
                    key === 'mode' ||
                    key === 'name' ||
                    key === 'scope' ||
                    key === 'new_conv' ||
                    key === 'platform' ||
                    key === 'self_id' ||
                    key === 'user_id' ||
                    key === 'username' ||
                    key === 'guild_id' ||
                    key === 'channel_id' ||
                    key === 'direct'
                ) {
                    continue
                }
                const paramKey =
                    key === 'missed'
                        ? 'missedRunPolicy'
                        : key === 'fire_at'
                          ? 'fireAt'
                          : key
                params[paramKey] =
                    typeof value !== 'object'
                        ? value
                        : value.kind === 'duration'
                          ? value.ms
                          : value.name
            }

            let replyTo: 'channel' | 'user' | 'silent' | undefined
            if (named.reply != null) {
                const value = valueToString(named.reply)
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
            if (named.mode != null) {
                const value = valueToString(named.mode)
                if (value !== 'chain' && value !== 'direct') {
                    return `Invalid mode: ${value}. Expected chain or direct.`
                }
                execMode = value
            }

            let newConversation = true
            if (named.new_conv != null) {
                if (typeof named.new_conv !== 'boolean') {
                    return 'Invalid new_conv: expected true or false.'
                }
                newConversation = named.new_conv
            }

            const task = await this.service.createTask(target.routing, {
                providerKind,
                name:
                    named.name == null ? undefined : valueToString(named.name),
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

    private async _setEnabled(ids: number[], enabled: boolean) {
        const tasks = await this._getTasks(ids)
        if (typeof tasks === 'string') return tasks

        for (const id of ids) {
            await this.service.setEnabled(id, enabled)
        }
        return `Trigger task ${ids.join(', ')} ${enabled ? 'enabled' : 'disabled'}.`
    }

    private async _snooze(ids: number[], after: Date) {
        if (ids.length < 1) {
            return 'taskId is required for snooze outside a trigger run.'
        }
        if (Number.isNaN(after.valueOf())) return 'Invalid snooze date.'

        const tasks = await this._getTasks(ids)
        if (typeof tasks === 'string') return tasks

        const result = []
        for (const id of ids) {
            result.push(formatTask(await this.service.snoozeTask(id, after)))
        }
        return JSON.stringify(result.length === 1 ? result[0] : result)
    }

    private async _getTasks(ids: number[]) {
        const tasks: TriggerTask[] = []
        for (const id of ids) {
            const task = await this.service.getTask(id)
            if (task == null) {
                return `Trigger task ${id} not found.`
            }
            tasks.push(task)
        }
        return tasks
    }
}

function buildRouting(
    session: Session,
    named: Record<string, DslValue>,
    direct?: boolean
) {
    const targetsOtherChat =
        named.platform != null ||
        named.self_id != null ||
        named.user_id != null ||
        named.username != null ||
        named.guild_id != null ||
        named.channel_id != null ||
        named.direct != null
    const isDirect =
        direct ??
        (session.isDirect && named.guild_id == null && named.channel_id == null)
    const guildId =
        named.guild_id == null
            ? (session.guildId ?? undefined)
            : valueToString(named.guild_id)
    const channelId =
        named.channel_id == null
            ? named.guild_id == null
                ? (session.channelId ?? guildId)
                : guildId
            : valueToString(named.channel_id)

    return {
        targetsOtherChat,
        routing: {
            platform:
                named.platform == null
                    ? session.platform
                    : valueToString(named.platform),
            selfId:
                named.self_id == null
                    ? session.selfId
                    : valueToString(named.self_id),
            userId:
                named.user_id == null
                    ? session.userId
                    : valueToString(named.user_id),
            username:
                named.username == null
                    ? session.username
                    : valueToString(named.username),
            guildId: isDirect ? undefined : guildId,
            channelId: isDirect ? undefined : channelId,
            isDirect
        } satisfies WakeupRouting
    }
}

function formatTask(task: TriggerTask) {
    return {
        id: task.id,
        name: task.name,
        providerKind: task.providerKind,
        enabled: task.enabled,
        bindingKey: task.bindingKey,
        platform: task.platform,
        selfId: task.selfId,
        userId: task.userId,
        guildId: task.guildId,
        channelId: task.channelId,
        isDirect: task.isDirect,
        nextFireAt: task.nextFireAt,
        params: task.params,
        createdBy: task.createdBy
    }
}
