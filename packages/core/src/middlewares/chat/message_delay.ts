/* eslint-disable operator-linebreak */
import { Context, Logger } from 'koishi'
import { Config } from '../../config'
import { Message } from '../../types'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { withResolver } from 'koishi-plugin-chatluna/utils/promise'

let logger: Logger

interface MessageQueue {
    messages: Message[]
    isProcessing: boolean
    pendingResolve?: () => void
}

const queues: Record<string, MessageQueue> = {}

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    logger = createLogger(ctx)

    chain
        .middleware('message_delay', async (session, context) => {
            if (
                !config.messageQueue ||
                (context.command != null && context.command.length > 0)
            ) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            const { room, inputMessage } = context.options
            const conversationId = room.conversationId

            let queue = queues[conversationId]

            if (!queue) {
                logger.debug(
                    `creating new queue for conversation ${conversationId}`
                )
                queue = {
                    messages: [],
                    isProcessing: false
                }
                queues[conversationId] = queue
                return ChainMiddlewareRunStatus.CONTINUE
            }

            if (queue.isProcessing) {
                logger.debug(
                    `conversation ${conversationId} is processing, handling queue`
                )

                if (shouldMergeMessages(queue.messages, [inputMessage])) {
                    queue.messages.push(inputMessage)
                    logger.debug(
                        `added message to existing queue for ${conversationId}`
                    )
                    return ChainMiddlewareRunStatus.STOP
                } else {
                    logger.debug(
                        `name mismatch, canceling old queue and starting new one for ${conversationId}`
                    )

                    if (queue.pendingResolve) {
                        queue.pendingResolve()
                        queue.pendingResolve = undefined
                    }

                    queue.messages = [inputMessage]

                    const { promise, resolve } = withResolver()
                    queue.pendingResolve = resolve

                    await promise
                    context.options.inputMessage = mergeMessages(queue.messages)
                    queue.messages = []
                    queue.isProcessing = false
                    queue.pendingResolve = undefined
                    return ChainMiddlewareRunStatus.CONTINUE
                }
            } else {
                logger.debug(
                    `starting processing for conversation ${conversationId}`
                )

                queue.messages = [inputMessage]
                queue.isProcessing = true

                const { promise, resolve } = withResolver()
                queue.pendingResolve = resolve

                await promise
                context.options.inputMessage = mergeMessages(queue.messages)
                queue.messages = []
                queue.isProcessing = false
                queue.pendingResolve = undefined
                return ChainMiddlewareRunStatus.CONTINUE
            }
        })
        .after('resolve_room')

    ctx.on('chatluna/after-chat', async (conversationId) => {
        const queue = queues[conversationId]
        if (queue && queue.isProcessing && queue.pendingResolve) {
            logger.debug(
                `chat completed for ${conversationId}, releasing queue`
            )
            queue.pendingResolve()
        }
    })

    ctx.on('chatluna/clear-chat-history', async (conversationId) => {
        const queue = queues[conversationId]
        if (queue) {
            logger.debug(
                `clearing chat history for ${conversationId}, terminating queue`
            )
            if (queue.pendingResolve) {
                queue.pendingResolve()
            }
            delete queues[conversationId]
        }
    })
}

function shouldMergeMessages(
    existingMessages: Message[],
    newMessages: Message[]
): boolean {
    if (existingMessages.length === 0 || newMessages.length === 0) {
        return true
    }

    const existingName = existingMessages[0].name
    const newName = newMessages[0].name

    return existingName === newName
}

function mergeMessages(messages: Message[]) {
    const newMessage: Message = {
        content: messages.map((message) => message.content).join('\n\n'),
        name: messages[0].name,
        conversationId: messages[0].conversationId,
        additional_kwargs: messages[0].additional_kwargs
    }

    for (const message of messages) {
        if (message.additional_kwargs) {
            newMessage.additional_kwargs = {
                ...newMessage.additional_kwargs,
                ...message.additional_kwargs
            }
        }
    }

    return newMessage
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        message_delay: never
    }
}
