import { Context } from 'koishi'
import { Config } from '../../config'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../../chains/chain'
import { checkAdmin } from 'koishi-plugin-chatluna/utils/koishi'

function getTargetConversation(context: ChainMiddlewareContext) {
    return (
        context.options.conversation_manage?.targetConversation ??
        context.options.targetConversation
    )
}

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('stop_chat', async (session, context) => {
            const { command } = context

            if (command !== 'stop_chat') return ChainMiddlewareRunStatus.SKIPPED

            const targetConversation = getTargetConversation(context)
            const resolved =
                await ctx.chatluna.conversation.resolveConversation(session, {
                    targetConversation,
                    presetLane: context.options.presetLane,
                    allPresetLanes: context.options.allPresetLanes,
                    permission: 'manage',
                    useRoutePresetLane:
                        context.options.presetLane == null &&
                        targetConversation == null,
                    mode: 'target'
                })
            const conversation = resolved.conversation

            if (conversation == null) {
                context.message = session.text('.no_active_chat')
                return ChainMiddlewareRunStatus.STOP
            }

            if (
                resolved.constraint.manageMode === 'admin' &&
                !(await checkAdmin(session))
            ) {
                context.message = session.text('.stop_failed')
                return ChainMiddlewareRunStatus.STOP
            }

            if (resolved.constraint.lockConversation) {
                context.message = session.text('.stop_failed')
                return ChainMiddlewareRunStatus.STOP
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
