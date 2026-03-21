import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { getRequestId } from '../../utils/chat_request'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('stop_chat', async (session, context) => {
            const { command } = context

            if (command !== 'stop_chat') return ChainMiddlewareRunStatus.SKIPPED

            const resolved =
                context.options.resolvedConversation !== undefined
                    ? {
                          conversation: context.options.resolvedConversation
                      }
                    : context.options.conversationId != null ||
                        context.options.targetConversation != null
                      ? {
                            conversation:
                                await ctx.chatluna.conversation.resolveCommandConversation(
                                    session,
                                    {
                                        conversationId:
                                            context.options.conversationId,
                                        targetConversation:
                                            context.options.targetConversation,
                                        presetLane: context.options.presetLane,
                                        permission: 'manage'
                                    }
                                )
                        }
                      : await ctx.chatluna.conversation.getCurrentConversation(
                            session
                        )
            const conversation = resolved.conversation

            if (conversation == null) {
                context.message = session.text('.no_active_chat')
                return ChainMiddlewareRunStatus.STOP
            }

            if (
                (
                    await ctx.chatluna.conversation.resolveContext(session, {
                        conversationId: conversation.id,
                        presetLane: context.options.presetLane
                    })
                ).constraint.lockConversation
            ) {
                context.message = session.text('.stop_failed')
                return ChainMiddlewareRunStatus.STOP
            }

            context.options.conversationId = conversation.id
            const requestId = getRequestId(session, conversation.id)

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
