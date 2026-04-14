import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { checkAdmin } from 'koishi-plugin-chatluna/utils/koishi'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('stop_chat', async (session, context) => {
            const { command } = context

            if (command !== 'stop_chat') return ChainMiddlewareRunStatus.SKIPPED

            const conversationId =
                context.options.conversationId ??
                context.options.conversation?.conversation?.id
            const conversation = (
                await ctx.chatluna.conversation.resolveConversation(session, {
                    conversationId,
                    presetLane: context.options.presetLane,
                    allPresetLanes: context.options.allPresetLanes,
                    permission: 'manage',
                    useRoutePresetLane:
                        context.options.presetLane == null &&
                        conversationId == null,
                    mode: 'target'
                })
            ).conversation

            if (conversation == null) {
                context.message = session.text('.no_active_chat')
                return ChainMiddlewareRunStatus.STOP
            }

            const resolvedContext =
                await ctx.chatluna.conversation.resolveConversation(session, {
                    conversationId: conversation.id,
                    presetLane: context.options.presetLane,
                    bindingKey: conversation.bindingKey,
                    mode: 'context'
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
            context.options.conversation = {
                ...context.options.conversation,
                ...resolvedContext,
                conversation,
                conversationId: conversation.id,
                mode: context.options.conversation?.mode ?? 'target'
            }
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
        .after('resolve_conversation')
        .before('lifecycle-request_conversation')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        stop_chat: never
    }
}
