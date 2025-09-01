/* eslint-disable operator-linebreak */
import { Context, Logger } from 'koishi'
import { Config } from '../../config'
import { Message } from '../../types'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../../chains/chain'

let logger: Logger

interface MessageBatch {
    messages: Message[]
    userName: string
    resolveWaiters: ((status?: ChainMiddlewareRunStatus) => void)[]
}

const batches = new Map<string, MessageBatch>()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    logger = createLogger(ctx)

    chain
        .middleware('message_delay', async (session, context) => {
            if (!config.messageQueue || context.command?.length > 0) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            context.options.messageId = crypto.randomUUID()

            const { room, inputMessage } = context.options
            const conversationId = room.conversationId
            const userName = inputMessage.name || 'unknown'
            const messageId = context.options.messageId

            const batch = batches.get(conversationId)

            if (!batch) {
                logger.debug(
                    `Creating new batch for ${conversationId}, messageId: ${messageId}`
                )
                batches.set(conversationId, {
                    messages: [inputMessage],
                    userName,
                    resolveWaiters: []
                })
                return ChainMiddlewareRunStatus.CONTINUE
            }

            if (batch.userName !== userName) {
                logger.debug(
                    `User mismatch for ${conversationId}, messageId: ${messageId}, waiting for batch completion`
                )
                return waitForBatchCompletion(
                    batch,
                    conversationId,
                    inputMessage,
                    userName,
                    context
                )
            }

            if (batch.resolveWaiters.length === 0) {
                logger.debug(
                    `Adding message to batch for ${conversationId}, messageId: ${messageId}, total: ${batch.messages.length + 1}`
                )
                batch.messages.push(inputMessage)
                return ChainMiddlewareRunStatus.STOP
            }

            logger.debug(
                `Interrupting and merging for ${conversationId}, messageId: ${messageId}`
            )
            return interruptAndMerge(batch, inputMessage, context)
        })
        .after('resolve_room')
        .before('lifecycle-handle_command')

    ctx.on('chatluna/after-chat', async (conversationId) => {
        const batch = batches.get(conversationId)
        if (batch?.resolveWaiters.length > 0) {
            logger.debug(
                `Completing batch for ${conversationId}, messages: ${batch.messages.length}`
            )
            batch.resolveWaiters.forEach((resolve) => resolve())
            batches.delete(conversationId)
        } else {
            logger.debug(`Cleaning up empty batch for ${conversationId}`)
            batches.delete(conversationId)
        }
    })

    ctx.on('chatluna/clear-chat-history', async (conversationId) => {
        const batch = batches.get(conversationId)
        if (batch) {
            logger.debug(
                `Clearing chat history for ${conversationId}, stopping ${batch.resolveWaiters.length} waiters`
            )
            batch.resolveWaiters.forEach((resolve) =>
                resolve(ChainMiddlewareRunStatus.STOP)
            )
            batches.delete(conversationId)
        }
    })
}

async function interruptAndMerge(
    batch: MessageBatch,
    message: Message,
    context: ChainMiddlewareContext
): Promise<ChainMiddlewareRunStatus> {
    const oldWaiters = batch.resolveWaiters
    batch.resolveWaiters = []
    batch.messages.push(message)

    oldWaiters.forEach((resolve) => resolve(ChainMiddlewareRunStatus.STOP))

    return new Promise((resolve) => {
        batch.resolveWaiters.push(() => {
            context.options.inputMessage = mergeMessages(batch.messages)
            resolve(ChainMiddlewareRunStatus.CONTINUE)
        })
    })
}

async function waitForBatchCompletion(
    batch: MessageBatch,
    conversationId: string,
    message: Message,
    userName: string,
    context: ChainMiddlewareContext
): Promise<ChainMiddlewareRunStatus> {
    return new Promise((resolve) => {
        batch.resolveWaiters.push(() => {
            batches.set(conversationId, {
                messages: [message],
                userName,
                resolveWaiters: [
                    () => {
                        const newBatch = batches.get(conversationId)!
                        context.options.inputMessage = mergeMessages(
                            newBatch.messages
                        )
                        batches.delete(conversationId)
                        resolve(ChainMiddlewareRunStatus.CONTINUE)
                    }
                ]
            })
        })
    })
}

function mergeMessages(messages: Message[]): Message {
    if (messages.length === 1) return messages[0]

    const base = messages[0]
    return {
        ...base,
        content: messages
            .map((msg) => msg.content)
            .filter(Boolean)
            .join('\n\n'),
        additional_kwargs: messages.reduce(
            (acc, msg) => ({
                ...acc,
                ...msg.additional_kwargs
            }),
            base.additional_kwargs || {}
        )
    }
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        message_delay: never
    }

    interface ChainMiddlewareContextOptions {
        messageId?: string
    }
}
