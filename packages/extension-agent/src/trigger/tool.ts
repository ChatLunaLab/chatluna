import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { getBaseBindingKey } from 'koishi-plugin-chatluna/services/chat'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type { ChatLunaAgentTriggerService } from '../service/trigger'

export class TriggerTool extends StructuredTool {
    name = 'trigger'

    description =
        'Manage scheduled or passive trigger tasks for the current chat (create/list/enable/disable/cancel/fire). ' +
        'See <trigger_tool> and <trigger_providers> in the system prompt for actions, providers, and per-provider params.'

    schema = z.object({
        action: z
            .enum([
                'list',
                'create',
                'enable',
                'disable',
                'cancel',
                'remove',
                'fire'
            ])
            .describe(
                'Operation to perform. See <trigger_tool> in system prompt.'
            ),
        taskId: z
            .number()
            .int()
            .optional()
            .describe('Required for enable/disable/cancel/remove/fire.'),
        providerKind: z
            .string()
            .optional()
            .describe(
                'Required for create. One of the providers listed in <trigger_providers>.'
            ),
        name: z.string().optional(),
        message: z
            .string()
            .optional()
            .describe(
                'Wakeup message; required when the chosen provider is marked "requires message".'
            ),
        replyTo: z.enum(['channel', 'user', 'silent']).optional(),
        execMode: z.literal('chain').optional(),
        nextFireAt: z
            .string()
            .optional()
            .describe('ISO date string for one-shot tasks.'),
        presetScope: z
            .enum(['current', 'all'])
            .optional()
            .describe(
                'Bind the task to the current preset lane (default) or to all presets of this chat.'
            ),
        newConversation: z
            .boolean()
            .optional()
            .describe(
                'When true, the first fire creates a fresh conversation (not set as active); subsequent fires reuse it.'
            ),
        params: z
            .record(z.any())
            .optional()
            .describe(
                'Provider-specific params. See <trigger_providers> in the system prompt for the type signature of each provider.'
            )
    })

    constructor(private readonly service: ChatLunaAgentTriggerService) {
        super({})
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        config: ChatLunaToolRunnable
    ) {
        const session = config.configurable.session
        const resolved =
            await this.service.ctx.chatluna.conversation.resolveConstraint(
                session
            )
        const baseKey = getBaseBindingKey(resolved.bindingKey)
        const ownsTask = (task: { bindingKey: string; createdBy: string }) =>
            (task.bindingKey === resolved.bindingKey ||
                task.bindingKey === baseKey) &&
            task.createdBy === session.userId

        if (input.action === 'list') {
            const tasks = (await this.service.listTasks()).filter(ownsTask)
            if (tasks.length < 1) {
                return 'No trigger tasks found for this chat.'
            }

            return JSON.stringify(
                tasks.map((task) => ({
                    id: task.id,
                    name: task.name,
                    providerKind: task.providerKind,
                    enabled: task.enabled,
                    nextFireAt: task.nextFireAt,
                    params: task.params
                }))
            )
        }

        if (input.action === 'enable') {
            if (input.taskId == null) {
                return 'taskId is required for enable.'
            }

            const task = await this.service.getTask(input.taskId)
            if (task == null || !ownsTask(task)) {
                return `Trigger task ${input.taskId} not found.`
            }

            await this.service.setEnabled(input.taskId, true)
            return `Trigger task ${input.taskId} enabled.`
        }

        if (input.action === 'disable') {
            if (input.taskId == null) {
                return 'taskId is required for disable.'
            }

            const task = await this.service.getTask(input.taskId)
            if (task == null || !ownsTask(task)) {
                return `Trigger task ${input.taskId} not found.`
            }

            await this.service.setEnabled(input.taskId, false)
            return `Trigger task ${input.taskId} disabled.`
        }

        if (input.action === 'cancel' || input.action === 'remove') {
            if (input.taskId == null) {
                return 'taskId is required for cancel.'
            }

            const task = await this.service.getTask(input.taskId)
            if (task == null || !ownsTask(task)) {
                return `Trigger task ${input.taskId} not found.`
            }

            await this.service.removeTask(input.taskId)
            return `Trigger task ${input.taskId} removed.`
        }

        if (input.action === 'fire') {
            if (input.taskId == null) {
                return 'taskId is required for fire.'
            }

            const task = await this.service.getTask(input.taskId)
            if (task == null || !ownsTask(task)) {
                return `Trigger task ${input.taskId} not found.`
            }

            const result = await this.service.fire(input.taskId)
            return JSON.stringify(result)
        }

        if (input.providerKind == null) {
            return 'providerKind is required for create. See <trigger_providers> in the system prompt.'
        }

        const provider = this.service
            .getProviders()
            .find((p) => p.kind === input.providerKind)
        if (provider == null) {
            return `Unknown providerKind: ${input.providerKind}. See <trigger_providers> in the system prompt.`
        }

        if (
            provider.needsMessage &&
            (input.message == null || input.message.trim().length < 1)
        ) {
            return `message is required for provider ${provider.kind}.`
        }

        const useAllScope = input.presetScope === 'all'
        const bindingKey = useAllScope
            ? getBaseBindingKey(resolved.bindingKey)
            : resolved.bindingKey
        const presetLane = useAllScope
            ? null
            : resolved.fixedPreset ||
              resolved.activePresetLane ||
              resolved.defaultPreset

        const task = await this.service.createTask(session, {
            providerKind: input.providerKind,
            name: input.name,
            presetLane,
            scope: useAllScope ? 'shared' : 'personal',
            bindingKey,
            nextFireAt: input.nextFireAt,
            params: input.params,
            createdBy: session.userId,
            source: 'agent',
            wakeupTemplate: {
                message: input.message,
                replyTo: input.replyTo,
                execMode: input.execMode,
                newConversation: input.newConversation
            }
        })

        return JSON.stringify({
            id: task.id,
            providerKind: task.providerKind,
            nextFireAt: task.nextFireAt,
            params: task.params
        })
    }
}
