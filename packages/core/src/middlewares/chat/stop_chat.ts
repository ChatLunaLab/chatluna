import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { checkAdmin } from 'koishi-plugin-chatluna/utils/koishi'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('stop_chat', async (session, context) => {
            const { command } = context

            if (command !== 'stop_chat') return ChainMiddlewareRunStatus.SKIPPED

            const hasTarget =
                context.options.resolvedConversation != null ||
                context.options.conversationId != null ||
                context.options.targetConversation != null
            let conversation = !hasTarget
                ? null
                : context.options.resolvedConversation != null
                  ? await ctx.chatluna.conversation.resolveCommandConversation(
                        session,
                        {
                            conversationId:
                                context.options.resolvedConversation.id,
                            presetLane: context.options.presetLane,
                            allPresetLanes: context.options.allPresetLanes,
                            permission: 'manage'
                        }
                    )
                  : await ctx.chatluna.conversation.resolveCommandConversation(
                        session,
                        {
                            conversationId: context.options.conversationId,
                            targetConversation:
                                context.options.targetConversation,
                            presetLane: context.options.presetLane,
                            allPresetLanes: context.options.allPresetLanes,
                            permission: 'manage'
                        }
                    )

            if (conversation == null) {
                conversation = (
                    await ctx.chatluna.conversation.getCurrentConversation(
                        session,
                        {
                            presetLane: context.options.presetLane,
                            useRoutePresetLane:
                                context.options.presetLane == null
                        }
                    )
                ).conversation

                if (conversation != null) {
                    conversation =
                        await ctx.chatluna.conversation.resolveCommandConversation(
                            session,
                            {
                                conversationId: conversation.id,
                                presetLane: context.options.presetLane,
                                allPresetLanes: context.options.allPresetLanes,
                                permission: 'manage'
                            }
                        )
                }
            }

            if (conversation == null) {
                context.message = session.text('.no_active_chat')
                return ChainMiddlewareRunStatus.STOP
            }

            const resolvedContext =
                await ctx.chatluna.conversation.resolveContext(session, {
                    conversationId: conversation.id,
                    presetLane: context.options.presetLane,
                    bindingKey: conversation.bindingKey
                })

            if (
                resolvedContext.constraint.manageMode === 'admin' &&
                !(await checkAdmin(session))
            ) {
                context.message = session.text('.stop_failed')
                return ChainMiddlewareRunStatus.STOP
            }

            if (resolvedContext.constraint.lockConversation) {
                context.message = session.text('.stop_failed')
                return ChainMiddlewareRunStatus.STOP
            }

            context.options.conversationId = conversation.id
            const status =
                ctx.chatluna.conversationRuntime.stopConversationRequest(
                    conversation.id
                )

            if (!status) {
                context.message = session.text('.no_active_chat')
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        stop_chat: never
    }
}
