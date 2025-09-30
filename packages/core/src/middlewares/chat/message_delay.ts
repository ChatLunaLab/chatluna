/* eslint-disable operator-linebreak */
import { Context, Disposable, Logger } from 'koishi'
import { Config } from '../../config'
import { Message } from '../../types'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../../chains/chain'
import { randomUUID } from 'crypto'

let logger: Logger

interface MessageBatch {
    messages: Message[]
    userName: string
    resolveWaiters: ((status?: ChainMiddlewareRunStatus) => void)[]
    timeout?: Disposable
    processorResolve?: (status: ChainMiddlewareRunStatus) => void
}

const batches = new Map<string, MessageBatch>()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    logger = createLogger(ctx)

    chain
        .middleware('message_delay', async (session, context) => {
            if (!config.messageQueue || context.command?.length > 0) {
                // 忽略命令执行或者不开启延时
                return ChainMiddlewareRunStatus.CONTINUE
            }

            context.options.messageId = randomUUID()

            const { room, inputMessage } = context.options
            const conversationId = room.conversationId
            const userName = inputMessage.name || 'unknown'
            const messageId = context.options.messageId

            const batch = batches.get(conversationId)

            if (!batch) {
                logger.debug(
                    `Creating new batch for ${conversationId}, messageId: ${messageId}`
                )
                const newBatch: MessageBatch = {
                    messages: [inputMessage],
                    userName,
                    resolveWaiters: []
                }
                batches.set(conversationId, newBatch)

                if (config.messageQueueDelay > 0) {
                    return await new Promise<ChainMiddlewareRunStatus>(
                        (resolve) => {
                            newBatch.processorResolve = resolve
                            newBatch.timeout = ctx.setTimeout(() => {
                                if (batches.get(conversationId) === newBatch) {
                                    logger.debug(
                                        // eslint-disable-next-line max-len
                                        `Delay timeout (${config.messageQueueDelay}s) for ${conversationId}, processing batch with ${newBatch.messages.length} messages`
                                    )
                                    context.options.inputMessage =
                                        mergeMessages(newBatch.messages)
                                    batches.delete(conversationId)
                                    resolve(ChainMiddlewareRunStatus.CONTINUE)
                                }
                            }, config.messageQueueDelay * 1000)
                        }
                    )
                }

                return ChainMiddlewareRunStatus.CONTINUE
            }

            if (batch.userName !== userName) {
                logger.debug(
                    `User mismatch for ${conversationId}, messageId: ${messageId}, waiting for batch completion`
                )
                return await waitForBatchCompletion(
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

                if (
                    config.messageQueueDelay > 0 &&
                    batch.timeout &&
                    batch.processorResolve
                ) {
                    batch.timeout()
                    batch.timeout = ctx.setTimeout(() => {
                        if (
                            batches.get(conversationId) === batch &&
                            batch.processorResolve
                        ) {
                            logger.debug(
                                `Delay timeout (${config.messageQueueDelay}s) for ${conversationId}, processing batch with ${batch.messages.length} messages`
                            )
                            context.options.inputMessage = mergeMessages(
                                batch.messages
                            )
                            batches.delete(conversationId)
                            batch.processorResolve(
                                ChainMiddlewareRunStatus.CONTINUE
                            )
                        }
                    }, config.messageQueueDelay * 1000)
                }

                return ChainMiddlewareRunStatus.STOP
            }

            logger.debug(
                `Interrupting and merging for ${conversationId}, messageId: ${messageId}`
            )
            return await interruptAndMerge(batch, inputMessage, context)
        })
        .after('check_room')
        .after('read_chat_message')
        .before('lifecycle-handle_command')

    const completeBatch = async (conversationId: string) => {
        const batch = batches.get(conversationId)
        if (batch?.resolveWaiters.length > 0) {
            logger.debug(
                `Completing batch for ${conversationId}, messages: ${batch.messages.length}`
            )
            if (batch.timeout) {
                batch.timeout()
            }
            batch.resolveWaiters.forEach((resolve) => resolve())
            batches.delete(conversationId)
        } else if (batch) {
            logger.debug(`Cleaning up batch for ${conversationId}`)
            if (batch.timeout) {
                batch.timeout()
            }
            if (batch.processorResolve) {
                batch.processorResolve(ChainMiddlewareRunStatus.STOP)
            }
            batches.delete(conversationId)
        }
    }

    ctx.on(
        'chatluna/after-chat',
        async (conversationId) => await completeBatch(conversationId)
    )

    ctx.on(
        'chatluna/after-chat-error',
        async (_, conversationId) => await completeBatch(conversationId)
    )

    ctx.on('chatluna/clear-chat-history', async (conversationId) => {
        const batch = batches.get(conversationId)
        if (batch) {
            logger.debug(
                `Clearing chat history for ${conversationId}, stopping ${batch.resolveWaiters.length} waiters`
            )
            if (batch.timeout) {
                batch.timeout()
            }
            batch.resolveWaiters.forEach((resolve) =>
                resolve(ChainMiddlewareRunStatus.STOP)
            )
            if (batch.processorResolve) {
                batch.processorResolve(ChainMiddlewareRunStatus.STOP)
            }
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
    const oldProcessor = batch.processorResolve

    batch.resolveWaiters = []
    batch.processorResolve = undefined
    batch.messages.push(message)

    if (batch.timeout) {
        batch.timeout()
        batch.timeout = undefined
    }

    oldWaiters.forEach((resolve) => resolve(ChainMiddlewareRunStatus.STOP))
    if (oldProcessor) {
        oldProcessor(ChainMiddlewareRunStatus.STOP)
    }

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
