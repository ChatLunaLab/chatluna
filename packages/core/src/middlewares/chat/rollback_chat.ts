import type { Context, Session } from 'koishi'
import { gzipDecode } from 'koishi-plugin-chatluna/utils/string'
import { Config } from '../../config'
import {
    ChainMiddlewareRunStatus,
    type ChainMiddlewareContext,
    type ChatChain
} from '../../chains/chain'
import { MessageRecord } from '../../services/conversation_types'
import {
    checkAdmin,
    transformMessageContentToElements
} from 'koishi-plugin-chatluna/utils/koishi'

const MAX_ROLLBACK_HOPS = 1000

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('rollback_chat', async (session, context) => {
            const { command } = context

            if (command !== 'rollback') return ChainMiddlewareRunStatus.SKIPPED

            const rollbackRound = context.options.rollback_round ?? 1
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

            if (
                conversation == null &&
                context.options.conversationId == null &&
                context.options.targetConversation == null &&
                context.options.resolvedConversation == null
            ) {
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
                context.message = session.text('.conversation_not_exist')
                return ChainMiddlewareRunStatus.STOP
            }

            context.options.conversationId = conversation.id

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
                            rollbackRound
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
    rollbackRound: number
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

    const resolved = await ctx.chatluna.conversation.resolveContext(session, {
        conversationId: current.id,
        presetLane: context.options.presetLane,
        bindingKey: current.bindingKey
    })

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
            resolved.effectiveModel ?? current.model,
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
