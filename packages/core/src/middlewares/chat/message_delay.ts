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

interface MessageTurnStarter {
    context: ChainMiddlewareContext
    resolve: (status: ChainMiddlewareRunStatus) => void
}

interface MessageTurn {
    userName: string
    messages: Message[]
    starter?: MessageTurnStarter
    timeout?: Disposable
    state: 'collecting' | 'waiting' | 'processing'
}

interface ConversationQueue {
    turns: MessageTurn[]
    inFlight: boolean
}

const queues = new Map<string, ConversationQueue>()

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

            const conversation = queues.get(conversationId) ?? {
                turns: [],
                inFlight: false
            }
            queues.set(conversationId, conversation)

            const tailTurn = conversation.turns[conversation.turns.length - 1]

            let turn: MessageTurn
            if (
                tailTurn &&
                tailTurn.state !== 'processing' &&
                tailTurn.userName === userName
            ) {
                turn = tailTurn
                logger.debug(
                    `Joining turn for ${conversationId}, messageId: ${messageId}, user: ${userName}, total: ${turn.messages.length + 1}`
                )
            } else {
                const state: MessageTurn['state'] =
                    conversation.turns.length === 0 &&
                    config.messageQueueDelay > 0
                        ? 'collecting'
                        : 'waiting'
                turn = {
                    messages: [],
                    userName,
                    state
                }
                conversation.turns.push(turn)
                logger.debug(
                    `Creating new turn for ${conversationId}, messageId: ${messageId}, user: ${userName}, queue: ${conversation.turns.length}`
                )
            }

            turn.messages.push(inputMessage)

            const statusPromise = awaitTurnStart(turn, context)

            if (turn.state === 'collecting') {
                resetTurnTimeout(ctx, config, conversationId, turn)
            }

            tryStartHeadTurn(conversationId, conversation)
            return await statusPromise
        })
        .after('check_room')
        .after('read_chat_message')
        .before('lifecycle-handle_command')

    const completeTurn = async (conversationId: string) => {
        const conversation = queues.get(conversationId)
        if (!conversation) {
            return
        }

        const current = conversation.turns.shift()
        conversation.inFlight = false

        if (current?.timeout) {
            current.timeout()
        }
        if (current?.starter) {
            current.starter.resolve(ChainMiddlewareRunStatus.STOP)
            current.starter = undefined
        }

        if (conversation.turns.length === 0) {
            queues.delete(conversationId)
            return
        }

        tryStartHeadTurn(conversationId, conversation)

        if (current) {
            logger.debug(
                `Completing turn for ${conversationId}, remaining: ${conversation.turns.length}`
            )
        }
    }

    ctx.on('chatluna/after-chat', completeTurn)

    ctx.on('chatluna/after-chat-error', (_, conversationId) =>
        completeTurn(conversationId)
    )

    ctx.on('chatluna/clear-chat-history', async (conversationId) => {
        const conversation = queues.get(conversationId)
        if (conversation) {
            const stoppedWaiters = conversation.turns.filter(
                (turn) => !!turn.starter
            ).length
            logger.debug(
                `Clearing chat history for ${conversationId}, stopping ${stoppedWaiters} waiters`
            )

            for (const turn of conversation.turns) {
                if (turn.timeout) {
                    turn.timeout()
                    turn.timeout = undefined
                }
                if (turn.starter) {
                    turn.starter.resolve(ChainMiddlewareRunStatus.STOP)
                    turn.starter = undefined
                }
            }

            queues.delete(conversationId)
        }
    })
}

function awaitTurnStart(
    turn: MessageTurn,
    context: ChainMiddlewareContext
): Promise<ChainMiddlewareRunStatus> {
    if (turn.starter) {
        turn.starter.resolve(ChainMiddlewareRunStatus.STOP)
        turn.starter = undefined
    }
    return new Promise((resolve) => {
        turn.starter = { resolve, context }
    })
}

function resetTurnTimeout(
    ctx: Context,
    config: Config,
    conversationId: string,
    turn: MessageTurn
) {
    if (turn.timeout) {
        turn.timeout()
    }
    turn.timeout = ctx.setTimeout(() => {
        const conversation = queues.get(conversationId)
        if (!conversation || conversation.turns[0] !== turn) {
            return
        }

        turn.state = 'waiting'
        turn.timeout = undefined

        if (conversation.inFlight) {
            return
        }
        logger.debug(
            // eslint-disable-next-line max-len
            `Delay timeout (${config.messageQueueDelay}s) for ${conversationId}, starting turn with ${turn.messages.length} messages`
        )
        startHeadTurn(conversationId, conversation, turn)
    }, config.messageQueueDelay * 1000)
}

function tryStartHeadTurn(
    conversationId: string,
    conversation: ConversationQueue
) {
    if (conversation.inFlight) {
        return
    }
    const head = conversation.turns[0]
    if (!head) {
        queues.delete(conversationId)
        return
    }
    if (head.state === 'collecting') {
        return
    }
    startHeadTurn(conversationId, conversation, head)
}

function startHeadTurn(
    conversationId: string,
    conversation: ConversationQueue,
    head: MessageTurn
) {
    if (conversation.inFlight) {
        return
    }
    if (conversation.turns[0] !== head) {
        return
    }
    if (!head.starter) {
        return
    }

    if (head.timeout) {
        head.timeout()
        head.timeout = undefined
    }

    const starter = head.starter
    head.starter = undefined

    conversation.inFlight = true
    head.state = 'processing'
    starter.context.options.inputMessage = mergeMessages(head.messages)
    head.messages = []
    starter.resolve(ChainMiddlewareRunStatus.CONTINUE)
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
