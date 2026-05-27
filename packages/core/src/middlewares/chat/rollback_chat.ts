import type { Context, Session } from 'koishi'
import { gzipDecode } from 'koishi-plugin-chatluna/utils/string'
import { Config } from '../../config'
import {
    type ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    type ChatChain
} from '../../chains/chain'
import { type ConversationResolution, type MessageRecord } from '../../types'
import {
    checkAdmin,
    transformMessageContentToElements
} from 'koishi-plugin-chatluna/utils/koishi'

const MAX_ROLLBACK_HOPS = 1000

function getTargetConversation(context: ChainMiddlewareContext) {
    return (
        context.options.conversation_manage?.targetConversation ??
        context.options.targetConversation
    )
}

function getConversationId(context: ChainMiddlewareContext) {
    return (
        context.options.conversation?.conversationId ??
        context.options.conversation?.conversation?.id
    )
}

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('rollback_chat', async (session, context) => {
            const { command } = context

            if (command !== 'rollback') return ChainMiddlewareRunStatus.SKIPPED

            const rollbackRound = context.options.rollback_round ?? 1
            const targetConversation = getTargetConversation(context)
            const conversationId =
                targetConversation == null
                    ? getConversationId(context)
                    : undefined
            const current = context.options.conversation
            const resolved =
                targetConversation == null &&
                current?.conversation != null &&
                current.conversationId != null &&
                current.bindingKey != null &&
                current.constraint != null
                    ? current
                    : await ctx.chatluna.conversation.resolveConversation(
                          session,
                          {
                              targetConversation,
                              conversationId,
                              presetLane: context.options.presetLane,
                              allPresetLanes: context.options.allPresetLanes,
                              permission: 'manage',
                              useRoutePresetLane:
                                  context.options.presetLane == null &&
                                  targetConversation == null &&
                                  conversationId == null,
                              mode: 'target'
                          }
                      )
            const conversation = resolved.conversation

            if (conversation == null) {
                context.message = session.text('.conversation_not_exist')
                return ChainMiddlewareRunStatus.STOP
            }

            const result =
                await ctx.chatluna.conversationRuntime.withConversationSync(
                    conversation,
                    () =>
                        rollbackConversation(
                            ctx,
                            config,
                            session,
                            context,
                            conversation,
                            rollbackRound,
                            resolved
                        )
                )

            if (result.status !== ChainMiddlewareRunStatus.CONTINUE) {
                context.message = result.msg
                return result.status
            }

            context.options.inputMessage = result.inputMessage

            await session.send(
                session.text('.rollback_success', [rollbackRound])
            )

            ctx.logger.debug(
                `rollback chat ${conversation.id} ${context.options.inputMessage}`
            )

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('lifecycle-handle_command')
        .after('resolve_conversation')
        .before('lifecycle-request_conversation')
}

async function decodeMessageContent(message: MessageRecord) {
    try {
        if (message.content != null) {
            return JSON.parse(await gzipDecode(message.content))
        }

        return message.text ?? ''
    } catch {
        return message.text ?? ''
    }
}

async function rollbackConversation(
    ctx: Context,
    config: Config,
    session: Session,
    context: ChainMiddlewareContext,
    conversation: { id: string },
    rollbackRound: number,
    resolved: ConversationResolution
) {
    const current = await ctx.chatluna.conversation.getConversation(
        conversation.id
    )

    if (current == null) {
        return {
            status: ChainMiddlewareRunStatus.STOP,
            msg: session.text('.conversation_not_exist')
        }
    }

    if (
        resolved.constraint.manageMode === 'admin' &&
        !(await checkAdmin(session))
    ) {
        return {
            status: ChainMiddlewareRunStatus.STOP,
            msg: session.text('.conversation_not_exist')
        }
    }

    if (resolved.constraint.lockConversation) {
        return {
            status: ChainMiddlewareRunStatus.STOP,
            msg: session.text('.conversation_not_exist')
        }
    }

    context.options.conversation = {
        ...context.options.conversation,
        ...resolved,
        conversation: current,
        conversationId: current.id,
        mode: context.options.conversation?.mode ?? 'target'
    }

    await ctx.chatluna.conversationRuntime.clearConversationInterfaceLocked(
        current
    )

    let parentId = current.latestMessageId
    const messages: MessageRecord[] = []
    let humanMessage: MessageRecord | undefined
    let humanCount = 0
    const seen = new Set<string>()

    while (parentId != null) {
        if (seen.has(parentId)) {
            ctx.logger.warn(`rollback cycle detected: ${parentId}`)
            break
        }

        if (seen.size >= MAX_ROLLBACK_HOPS) {
            ctx.logger.warn(`rollback hop limit reached: ${current.id}`)
            break
        }

        seen.add(parentId)

        const message = await ctx.database.get('chatluna_message', {
            conversationId: current.id,
            id: parentId
        })
        const currentMessage = message[0]

        if (currentMessage == null) {
            break
        }

        parentId = currentMessage.parentId
        messages.unshift(currentMessage)

        if (currentMessage.role === 'human') {
            humanMessage = currentMessage
            humanCount += 1

            if (humanCount >= rollbackRound) {
                break
            }
        }
    }

    if (humanCount < rollbackRound || humanMessage == null) {
        return {
            status: ChainMiddlewareRunStatus.STOP,
            msg: session.text('.no_chat_history')
        }
    }

    let inputMessage = context.options.inputMessage

    if ((context.options.message?.length ?? 0) < 1) {
        const humanContent = await decodeMessageContent(humanMessage)

        inputMessage = await ctx.chatluna.messageTransformer.transform(
            session,
            transformMessageContentToElements(humanContent),
            ctx.chatluna.conversation.pickModel(resolved.constraint, current) ??
                current.model,
            undefined,
            {
                quote: false,
                includeQuoteReply: config.includeQuoteReply
            }
        )
    }

    await ctx.database.remove('chatluna_message', {
        id: messages.map((message) => message.id)
    })

    await ctx.database.upsert('chatluna_conversation', [
        {
            id: current.id,
            latestMessageId: humanMessage.parentId ?? null,
            updatedAt: new Date()
        }
    ])

    return {
        status: ChainMiddlewareRunStatus.CONTINUE,
        inputMessage
    }
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        rollback_chat: never
    }
    interface ChainMiddlewareContextOptions {
        rollback_round?: number
    }
}
