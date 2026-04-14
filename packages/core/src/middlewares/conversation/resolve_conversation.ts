import { Context } from 'koishi'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../../chains/chain'
import { Config } from '../../config'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('resolve_conversation', async (session, context) => {
            const presetLane = getPresetLane(context)
            const targetConversation = getTargetConversation(context)
            const conversationId = getConversationId(
                context,
                targetConversation != null
            )
            const targetValue = getTargetValue(context)
            const includeArchived = getIncludeArchived(context)
            const useRoutePresetLane =
                presetLane == null &&
                conversationId == null &&
                targetConversation == null

            context.options.presetLane = presetLane

            let resolved

            try {
                resolved = await ctx.chatluna.conversation.resolveConversation(
                    session,
                    {
                        mode:
                            conversationId != null || targetConversation != null
                                ? 'target'
                                : 'context',
                        conversationId,
                        targetConversation,
                        presetLane,
                        includeArchived,
                        allPresetLanes: context.options.allPresetLanes,
                        useRoutePresetLane
                    }
                )
            } catch (error) {
                if (
                    error instanceof Error &&
                    error.message === 'Conversation target is ambiguous.'
                ) {
                    context.message = session.text(
                        'chatluna.conversation.messages.target_ambiguous'
                    )
                    return ChainMiddlewareRunStatus.STOP
                }

                if (
                    error instanceof Error &&
                    error.message ===
                        'Conversation does not belong to current route.'
                ) {
                    context.message = session.text(
                        'chatluna.conversation.messages.target_outside_route'
                    )
                    return ChainMiddlewareRunStatus.STOP
                }

                throw error
            }

            if (
                (conversationId != null || targetConversation != null) &&
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

            if (resolved.conversationId != null) {
                context.options.conversationId = resolved.conversationId
            }

            return ChainMiddlewareRunStatus.CONTINUE
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
    context: ChainMiddlewareContext,
    hasTargetConversation: boolean
) {
    if (hasTargetConversation) {
        return undefined
    }

    return (
        context.options.conversationId ??
        context.options.conversation?.conversationId ??
        context.options.conversation?.conversation?.id
    )
}

function getIncludeArchived(context: ChainMiddlewareContext) {
    return context.options.conversation_manage?.includeArchived
}

function getTargetValue(context: ChainMiddlewareContext) {
    const targetConversation = getTargetConversation(context)

    return (
        getConversationId(context, targetConversation != null) ??
        targetConversation
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
