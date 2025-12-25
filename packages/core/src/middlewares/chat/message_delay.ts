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
    collectWaiters: ((status?: ChainMiddlewareRunStatus) => void)[]
    timeout?: Disposable
    state: 'collecting' | 'processing'
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
                    resolveWaiters: [],
                    collectWaiters: [],
                    state:
                        config.messageQueueDelay > 0
                            ? 'collecting'
                            : 'processing'
                }
                batches.set(conversationId, newBatch)

                if (config.messageQueueDelay > 0) {
                    resetBatchTimeout(ctx, config, newBatch, conversationId)
                    return await awaitCollectingBatch(newBatch, context)
                }

                newBatch.messages = []
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

            if (batch.state === 'collecting') {
                logger.debug(
                    `Adding message to batch for ${conversationId}, messageId: ${messageId}, total: ${batch.messages.length + 1}`
                )
                batch.messages.push(inputMessage)

                if (config.messageQueueDelay > 0) {
                    resetBatchTimeout(ctx, config, batch, conversationId)
                }
                return await awaitCollectingBatch(batch, context)
            }

            logger.debug(
                `Waiting for batch completion for ${conversationId}, messageId: ${messageId}`
            )
            const status = await awaitBatchCompletion(batch, inputMessage)
            if (status === ChainMiddlewareRunStatus.STOP) {
                return status
            }
            logger.debug(
                `Interrupting and merging for ${conversationId}, messageId: ${messageId}`
            )
            return interruptAndMerge(batch, context)
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
            const waiters = batch.resolveWaiters
            batch.resolveWaiters = []
            waiters.forEach((resolve) =>
                resolve(ChainMiddlewareRunStatus.CONTINUE)
            )
        } else if (batch) {
            logger.debug(`Cleaning up batch for ${conversationId}`)
            if (batch.timeout) {
                batch.timeout()
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
            batch.collectWaiters.forEach((resolve) =>
                resolve(ChainMiddlewareRunStatus.STOP)
            )
            batches.delete(conversationId)
        }
    })
}

function interruptAndMerge(
    batch: MessageBatch,
    context: ChainMiddlewareContext
): ChainMiddlewareRunStatus {
    if (batch.messages.length === 0) {
        return ChainMiddlewareRunStatus.STOP
    }
    context.options.inputMessage = mergeMessages(batch.messages)
    batch.messages = []
    batch.state = 'processing'
    return ChainMiddlewareRunStatus.CONTINUE
}

async function awaitCollectingBatch(
    batch: MessageBatch,
    context: ChainMiddlewareContext
): Promise<ChainMiddlewareRunStatus> {
    resolveCollectWaiters(batch, ChainMiddlewareRunStatus.STOP)
    return await new Promise((resolve) => {
        batch.collectWaiters.push((status) => {
            if (status === ChainMiddlewareRunStatus.STOP) {
                resolve(ChainMiddlewareRunStatus.STOP)
                return
            }
            context.options.inputMessage = mergeMessages(batch.messages)
            batch.messages = []
            batch.state = 'processing'
            resolve(ChainMiddlewareRunStatus.CONTINUE)
        })
    })
}

function resolveCollectWaiters(
    batch: MessageBatch,
    status: ChainMiddlewareRunStatus
) {
    const waiters = batch.collectWaiters
    batch.collectWaiters = []
    waiters.forEach((resolve) => resolve(status))
}

function resetBatchTimeout(
    ctx: Context,
    config: Config,
    batch: MessageBatch,
    conversationId: string
) {
    if (batch.timeout) {
        batch.timeout()
    }
    batch.timeout = ctx.setTimeout(() => {
        if (batches.get(conversationId) === batch) {
            logger.debug(
                // eslint-disable-next-line max-len
                `Delay timeout (${config.messageQueueDelay}s) for ${conversationId}, processing batch with ${batch.messages.length} messages`
            )
            batch.timeout = undefined
            resolveCollectWaiters(batch, ChainMiddlewareRunStatus.CONTINUE)
        }
    }, config.messageQueueDelay * 1000)
}

async function awaitBatchCompletion(
    batch: MessageBatch,
    message: Message
): Promise<ChainMiddlewareRunStatus> {
    if (batch.resolveWaiters.length === 0) {
        batch.messages = [message]
    } else {
        batch.messages.push(message)
    }
    return await new Promise((resolve) => {
        batch.resolveWaiters.push((status) => {
            resolve(status ?? ChainMiddlewareRunStatus.CONTINUE)
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
        batch.resolveWaiters.push((status) => {
            if (status === ChainMiddlewareRunStatus.STOP) {
                resolve(ChainMiddlewareRunStatus.STOP)
                return
            }
            batches.set(conversationId, {
                messages: [message],
                userName,
                resolveWaiters: [
                    (nextStatus) => {
                        if (nextStatus === ChainMiddlewareRunStatus.STOP) {
                            resolve(ChainMiddlewareRunStatus.STOP)
                            return
                        }
                        const newBatch = batches.get(conversationId)!
                        context.options.inputMessage = mergeMessages(
                            newBatch.messages
                        )
                        newBatch.messages = []
                        batches.delete(conversationId)
                        resolve(ChainMiddlewareRunStatus.CONTINUE)
                    }
                ],
                collectWaiters: [],
                state: 'processing'
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
