import { Context } from 'koishi'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../../chains/chain'
import { Config } from '../../config'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { parseDeleteSeqs } from '../../utils/conversation'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('resolve_conversation', async (session, context) => {
            const { options } = context
            if (options.conversation?.conversation != null) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            const presetLane =
                options.conversation_manage?.presetLane ?? options.presetLane
            const targetConversation =
                options.conversation_manage?.targetConversation ??
                options.targetConversation
            const batchTarget =
                context.command === 'conversation_delete' &&
                parseDeleteSeqs(targetConversation) !== undefined
            const explicitConversationId =
                options.conversation?.conversationId ??
                options.conversation?.conversation?.id
            const hasExplicitTarget =
                targetConversation != null || explicitConversationId != null
            const conversationId =
                targetConversation != null ? undefined : explicitConversationId
            const targetValue =
                targetConversation ?? explicitConversationId ?? conversationId
            const includeArchived = options.conversation_manage?.includeArchived

            options.presetLane = presetLane

            try {
                const resolved =
                    await ctx.chatluna.conversation.resolveConversation(
                        session,
                        {
                            mode: hasExplicitTarget ? 'target' : 'context',
                            conversationId,
                            targetConversation,
                            presetLane,
                            includeArchived,
                            allPresetLanes: options.allPresetLanes,
                            useRoutePresetLane:
                                presetLane == null && !hasExplicitTarget
                        }
                    )

                if (hasExplicitTarget && resolved.conversation == null) {
                    if (batchTarget) {
                        options.conversation = resolved
                        return ChainMiddlewareRunStatus.CONTINUE
                    }

                    context.message =
                        targetValue == null
                            ? notFoundMessage(session, context)
                            : await targetNotFoundMessage(
                                  ctx,
                                  session,
                                  context,
                                  targetValue,
                                  presetLane,
                                  includeArchived
                              )
                    return ChainMiddlewareRunStatus.STOP
                }

                const updated =
                    config.autoUpdateConversationModel &&
                    resolved.constraint.autoUpdateModel === true
                        ? await ctx.chatluna.conversation.applyAutoModelUpdate(
                              resolved,
                              context.command
                          )
                        : null

                if (updated != null) {
                    resolved.conversation = updated
                    resolved.conversationId = updated.id
                    resolved.effectiveModel = updated.model
                }

                options.conversation = resolved
                return ChainMiddlewareRunStatus.CONTINUE
            } catch (error) {
                if (error instanceof ChatLunaError) {
                    if (
                        error.errorCode ===
                        ChatLunaErrorCode.CONVERSATION_TARGET_AMBIGUOUS
                    ) {
                        context.message = session.text(
                            'chatluna.conversation.messages.target_ambiguous'
                        )
                        return ChainMiddlewareRunStatus.STOP
                    }
                    if (
                        error.errorCode ===
                        ChatLunaErrorCode.CONVERSATION_TARGET_OUTSIDE_ROUTE
                    ) {
                        context.message = session.text(
                            'chatluna.conversation.messages.target_outside_route'
                        )
                        return ChainMiddlewareRunStatus.STOP
                    }
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

function notFoundMessage(
    session: ChainMiddlewareContext['session'],
    context: ChainMiddlewareContext
) {
    return context.command?.startsWith('conversation_')
        ? session.text('chatluna.conversation.messages.target_not_found')
        : session.text('commands.chatluna.chat.messages.conversation_not_exist')
}

const TARGET_SUFFIX_BY_COMMAND: Record<string, string> = {
    conversation_switch: 'commands.chatluna.switch.arguments.conversation',
    conversation_archive: 'commands.chatluna.archive.arguments.conversation',
    conversation_restore: 'commands.chatluna.restore.arguments.conversation',
    conversation_export: 'commands.chatluna.export.arguments.conversation',
    conversation_compress: 'commands.chatluna.compress.options.conversation',
    conversation_delete: 'commands.chatluna.delete.arguments.conversation'
}

function targetSuffixKey(context: ChainMiddlewareContext) {
    const exact = TARGET_SUFFIX_BY_COMMAND[context.command ?? '']
    if (exact != null) return exact
    return context.command?.startsWith('conversation_')
        ? 'commands.chatluna.conversation.options.conversation'
        : 'commands.chatluna.chat.text.options.conversation'
}

async function targetNotFoundMessage(
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
        return notFoundMessage(session, context)
    }

    return session.suggest({
        actual: targetValue,
        expect,
        suffix: session.text(targetSuffixKey(context))
    })
}
