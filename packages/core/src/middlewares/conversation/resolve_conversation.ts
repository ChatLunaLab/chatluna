import { Context } from 'koishi'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../../chains/chain'
import { Config } from '../../config'
import type {
    ConversationRecord,
    ResolvedConversationContext
} from '../../services/conversation_types'

function getPresetLane(context: ChainMiddlewareContext) {
    return (
        context.options.conversation_manage?.presetLane ??
        context.options.presetLane
    )
}

function getTargetConversation(context: ChainMiddlewareContext) {
    return (
        context.options.conversation_manage?.targetConversation ??
        context.options.targetConversation
    )
}

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('resolve_conversation', async (session, context) => {
            const presetLane = getPresetLane(context)
            const targetConversation = getTargetConversation(context)
            const useRoutePresetLane =
                presetLane == null &&
                context.options.conversationId == null &&
                context.options.resolvedConversation == null &&
                targetConversation == null

            context.options.presetLane = presetLane

            if (
                context.options.conversationId == null &&
                targetConversation != null
            ) {
                const conversation =
                    await ctx.chatluna.conversation.resolveCommandConversation(
                        session,
                        {
                            targetConversation,
                            presetLane,
                            allPresetLanes: context.options.allPresetLanes
                        }
                    )

                if (conversation == null) {
                    context.message = session.text(
                        'commands.chatluna.chat.messages.conversation_not_exist'
                    )
                    return ChainMiddlewareRunStatus.STOP
                }

                context.options.conversationId = conversation.id
                context.options.resolvedConversation = conversation
            }

            const current = context.options.resolvedConversation
            let resolved =
                current != null &&
                context.options.resolvedConversationContext?.conversation
                    ?.id === current.id &&
                context.options.resolvedConversationContext.bindingKey ===
                    current.bindingKey
                    ? context.options.resolvedConversationContext
                    : await ctx.chatluna.conversation.resolveContext(session, {
                          conversationId: context.options.conversationId,
                          bindingKey: current?.bindingKey,
                          presetLane: current == null ? presetLane : undefined,
                          useRoutePresetLane:
                              current == null ? useRoutePresetLane : false
                      })

            if (
                resolved.conversation != null &&
                resolved.conversation.bindingKey !== resolved.bindingKey
            ) {
                resolved = await ctx.chatluna.conversation.resolveContext(
                    session,
                    {
                        conversationId: resolved.conversation.id,
                        bindingKey: resolved.conversation.bindingKey
                    }
                )
            }

            context.options.resolvedConversation = resolved.conversation
            context.options.resolvedConversationContext = resolved

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('read_chat_message')
        .before('resolve_model')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        resolve_conversation: never
    }

    interface ChainMiddlewareContextOptions {
        allPresetLanes?: boolean
        resolvedConversation?: ConversationRecord | null
        resolvedConversationContext?: ResolvedConversationContext
    }
}
