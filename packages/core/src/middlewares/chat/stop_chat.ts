import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { checkAdmin } from 'koishi-plugin-chatluna/utils/koishi'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('stop_chat', async (session, context) => {
            const { command } = context

            if (command !== 'stop_chat') return ChainMiddlewareRunStatus.SKIPPED

            let conversation =
                context.options.resolvedConversation != null
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
                        session
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
            const requestId = ctx.chatluna.conversationRuntime.getRequestId(
                session,
                conversation.id
            )

            if (requestId == null) {
                context.message = session.text('.no_active_chat')
                return ChainMiddlewareRunStatus.STOP
            }

            const status =
                await ctx.chatluna.conversationRuntime.stopRequest(requestId)

            if (status === null) {
                context.message = session.text('.no_active_chat')
            } else if (!status) {
                context.message = session.text('.stop_failed')
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
