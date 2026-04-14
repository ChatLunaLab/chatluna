import { Context } from 'koishi'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../../chains/chain'
import { Config } from '../../config'
import { ConversationResolutionError } from '../../services/conversation_types'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('resolve_conversation', async (session, context) => {
            const presetLane = getPresetLane(context)
            const targetConversation = getTargetConversation(context)
            const explicitConversationId = getExplicitConversationId(context)
            const hasExplicitTarget =
                targetConversation != null || explicitConversationId != null
            const conversationId = getConversationId(
                targetConversation != null,
                explicitConversationId
            )
            const targetValue =
                targetConversation ?? explicitConversationId ?? conversationId
            const includeArchived =
                context.options.conversation_manage?.includeArchived
            const useRoutePresetLane = presetLane == null && !hasExplicitTarget

            context.options.presetLane = presetLane

            try {
                const resolved =
                    await ctx.chatluna.conversation.resolveConversation(
                    session,
                    {
                        mode:
                            hasExplicitTarget ? 'target' : 'context',
                        conversationId,
                        targetConversation,
                        presetLane,
                        includeArchived,
                        allPresetLanes: context.options.allPresetLanes,
                        useRoutePresetLane
                    }
                )

                if (
                    hasExplicitTarget &&
                    resolved.conversation == null
                ) {
                    context.message =
                        targetValue == null
                            ? getNotFoundMessage(session, context)
                            : await getTargetNotFoundMessage(
                                  ctx,
                                  session,
                                  context,
                                  targetValue,
                                  presetLane,
                                  includeArchived
                              )
                    return ChainMiddlewareRunStatus.STOP
                }

                context.options.conversation = resolved

                return ChainMiddlewareRunStatus.CONTINUE
            } catch (error) {
                if (
                    error instanceof ConversationResolutionError &&
                    error.code === 'ambiguous_target'
                ) {
                    context.message = session.text(
                        'chatluna.conversation.messages.target_ambiguous'
                    )
                    return ChainMiddlewareRunStatus.STOP
                }

                if (
                    error instanceof ConversationResolutionError &&
                    error.code === 'target_outside_route'
                ) {
                    context.message = session.text(
                        'chatluna.conversation.messages.target_outside_route'
                    )
                    return ChainMiddlewareRunStatus.STOP
                }

                throw error
            }
        })
        .after('read_chat_message')
        .before('transform_chat_message')
        .before('resolve_model')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        resolve_conversation: never
    }

    interface ChainMiddlewareContextOptions {
        allPresetLanes?: boolean
    }
}

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

function getConversationId(
    hasTargetConversation: boolean,
    explicitConversationId?: string
) {
    if (hasTargetConversation) {
        return undefined
    }

    return explicitConversationId
}

function getExplicitConversationId(context: ChainMiddlewareContext) {
    return (
        context.options.conversation?.conversationId ??
        context.options.conversation?.conversation?.id
    )
}

function getNotFoundMessage(
    session: ChainMiddlewareContext['session'],
    context: ChainMiddlewareContext
) {
    return context.command?.startsWith('conversation_')
        ? session.text('chatluna.conversation.messages.target_not_found')
        : session.text('commands.chatluna.chat.messages.conversation_not_exist')
}

function getTargetSuffixKey(context: ChainMiddlewareContext) {
    const key = {
        conversation_switch: 'commands.chatluna.switch.arguments.conversation',
        conversation_archive:
            'commands.chatluna.archive.arguments.conversation',
        conversation_restore:
            'commands.chatluna.restore.arguments.conversation',
        conversation_export: 'commands.chatluna.export.arguments.conversation',
        conversation_compress:
            'commands.chatluna.compress.arguments.conversation',
        conversation_delete: 'commands.chatluna.delete.arguments.conversation'
    }[context.command ?? '']

    if (key != null) {
        return key
    }

    return context.command?.startsWith('conversation_')
        ? 'commands.chatluna.conversation.options.conversation'
        : 'commands.chatluna.chat.text.options.conversation'
}

async function getTargetNotFoundMessage(
    ctx: Context,
    session: ChainMiddlewareContext['session'],
    context: ChainMiddlewareContext,
    targetValue: string,
    presetLane?: string,
    includeArchived?: boolean
) {
    const entries = await ctx.chatluna.conversation.listConversationEntries(
        session,
        {
            presetLane,
            includeArchived,
            allPresetLanes: context.options.allPresetLanes
        }
    )
    const expect = Array.from(
        new Set(
            entries.flatMap((item) => [
                item.conversation.id,
                String(item.displaySeq),
                item.conversation.title
            ])
        )
    ).filter((item) => item.length > 0)

    if (expect.length === 0 || typeof session.suggest !== 'function') {
        return getNotFoundMessage(session, context)
    }

    return session.suggest({
        actual: targetValue,
        expect,
        suffix: session.text(getTargetSuffixKey(context))
    })
}
