import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import fs from 'fs/promises'
import { ConversationRecord } from '../../services/conversation_types'

export function apply(ctx: Context, _config: Config, chain: ChatChain) {
    chain
        .middleware('delete_preset', async (session, context) => {
            const { command } = context

            if (command !== 'delete_preset')
                return ChainMiddlewareRunStatus.SKIPPED

            const presetName = context.options.deletePreset
            const preset = ctx.chatluna.preset

            const presetTemplate = preset.getPreset(presetName).value
            if (presetTemplate == null) {
                await context.send(session.text('.not_found'))
                return ChainMiddlewareRunStatus.STOP
            }

            const allPreset = preset.getAllPreset(false).value

            if (allPreset.length === 1) {
                await context.send(session.text('.only_one_preset'))
                return ChainMiddlewareRunStatus.STOP
            }

            const usesDefaultPreset = presetTemplate.triggerKeyword.includes(
                _config.defaultPreset
            )
            const nextPreset =
                !usesDefaultPreset &&
                preset.getPreset(_config.defaultPreset, false).value != null
                    ? _config.defaultPreset
                    : allPreset.find(
                          (name) =>
                              !presetTemplate.triggerKeyword.includes(name)
                      )

            if (nextPreset == null) {
                await context.send(session.text('.only_one_preset'))
                return ChainMiddlewareRunStatus.STOP
            }

            await context.send(session.text('.confirm_delete', [presetName]))

            const result = await session.prompt(1000 * 30)

            if (!result) {
                context.message = session.text('.timeout', [presetName])
                return ChainMiddlewareRunStatus.STOP
            }

            if (result !== 'Y') {
                context.message = session.text('.cancelled', [presetName])
                return ChainMiddlewareRunStatus.STOP
            }

            const conversations = (await ctx.database.get(
                'chatluna_conversation',
                {}
            )) as ConversationRecord[]
            const updatedAt = new Date()
            const patched = conversations
                .filter((conversation) =>
                    presetTemplate.triggerKeyword.includes(conversation.preset)
                )
                .map((conversation) => ({
                    ...conversation,
                    preset: nextPreset,
                    updatedAt
                }))

            if (patched.length > 0) {
                await ctx.database.upsert('chatluna_conversation', patched)
            }

            if (usesDefaultPreset) {
                _config.defaultPreset = nextPreset
                ctx.chatluna.config.defaultPreset = nextPreset
                ctx.chatluna.currentConfig.defaultPreset = nextPreset
            }

            try {
                await fs.rm(presetTemplate.path)
            } catch (e) {
                ctx.logger.error(e)
            }

            context.message = session.text('.success', [presetName])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        delete_preset: string
    }

    interface ChainMiddlewareContextOptions {
        deletePreset?: string
    }
}