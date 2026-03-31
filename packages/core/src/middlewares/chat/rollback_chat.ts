import { Context } from 'koishi'
import { gzipDecode } from 'koishi-plugin-chatluna/utils/string'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { MessageRecord } from '../../services/conversation_types'
import { logger } from '../..'
import {
    checkAdmin,
    transformMessageContentToElements
} from '../../utils/koishi'

const MAX_ROLLBACK_HOPS = 1000

async function decodeMessageContent(message: MessageRecord) {
    try {
        return JSON.parse(
            message.content
                ? await gzipDecode(message.content)
                : (message.text ?? '""')
        )
    } catch {
        return message.text ?? ''
    }
}

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
                                permission: 'manage'
                            }
                        )
                }
            }

            if (conversation == null) {
                context.message = session.text('.conversation_not_exist')
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
                context.message = session.text('.conversation_not_exist')
                return ChainMiddlewareRunStatus.STOP
            }

            if (resolvedContext.constraint.lockConversation) {
                context.message = session.text('.conversation_not_exist')
                return ChainMiddlewareRunStatus.STOP
            }

            context.options.conversationId = conversation.id

            await ctx.chatluna.conversationRuntime.clearConversationInterface(
                conversation
            )

            let parentId = conversation.latestMessageId
            const messages: MessageRecord[] = []
            let humanMessage: MessageRecord | undefined
            let humanCount = 0
            const seen = new Set<string>()

            while (parentId != null) {
                if (seen.has(parentId)) {
                    logger.warn(`rollback cycle detected: ${parentId}`)
                    break
                }

                if (seen.size >= MAX_ROLLBACK_HOPS) {
                    logger.warn(
                        `rollback hop limit reached: ${conversation.id}`
                    )
                    break
                }

                seen.add(parentId)

                const message = await ctx.database.get('chatluna_message', {
                    conversationId: conversation.id,
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
                context.message = session.text('.no_chat_history')
                return ChainMiddlewareRunStatus.STOP
            }

            const previousLatestId = humanMessage.parentId ?? null

            await ctx.database.upsert('chatluna_conversation', [
                {
                    id: conversation.id,
                    latestMessageId: previousLatestId,
                    updatedAt: new Date()
                }
            ])

            if ((context.options.message?.length ?? 0) < 1) {
                const reResolved =
                    await ctx.chatluna.conversation.resolveContext(session, {
                        conversationId: conversation.id
                    })
                const humanContent = await decodeMessageContent(humanMessage)

                context.options.inputMessage =
                    await ctx.chatluna.messageTransformer.transform(
                        session,
                        transformMessageContentToElements(humanContent),
                        reResolved.effectiveModel ?? conversation.model,
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

            await session.send(
                session.text('.rollback_success', [rollbackRound])
            )

            logger.debug(
                `rollback chat ${conversation.id} ${context.options.inputMessage}`
            )

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        rollback_chat: never
    }
    interface ChainMiddlewareContextOptions {
        rollback_round?: number
    }
}
