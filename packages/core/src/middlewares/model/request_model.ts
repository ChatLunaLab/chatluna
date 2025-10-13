import { Context, Element, Fragment, Logger, Session } from 'koishi'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from 'koishi-plugin-chatluna/chains'
import { Config } from '../../config'
import { ConversationRoom, Message } from '../../types'
import { renderMessage } from '../chat/render_message'
import {
    formatToolCall,
    formatUserPromptString,
    getMessageContent,
    getSystemPromptVariables,
    PresetPostHandler
} from 'koishi-plugin-chatluna/utils/string'
import { updateChatTime } from '../../chains/rooms'
import {
    MessageEditQueue,
    sendInitialMessage,
    StreamingBufferText
} from '../../utils/buffer_text'
import {
    BaseMessageChunk,
    MessageContent,
    MessageContentComplex
} from '@langchain/core/messages'
import { randomUUID } from 'crypto'

let logger: Logger

const requestIdCache = new Map<string, string>()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    logger = createLogger(ctx)
    chain
        .middleware('request_model', async (session, context) => {
            const { room, inputMessage } = context.options

            const presetTemplate = ctx.chatluna.preset.getPreset(
                room.preset
            ).value

            if (presetTemplate == null) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.PRESET_NOT_FOUND,
                    new Error(`Preset ${room.preset} not found`)
                )
            }

            const originContent = inputMessage.content

            if (presetTemplate.formatUserPromptString != null) {
                inputMessage.content = await processUserPrompt(
                    config,
                    presetTemplate,
                    session,
                    inputMessage.content,
                    room
                )
            }

            const bufferText = new StreamingBufferText(
                3,
                presetTemplate.config?.postHandler?.prefix,
                presetTemplate.config?.postHandler?.postfix
            )

            const postHandler = presetTemplate.config?.postHandler
                ? new PresetPostHandler(
                      ctx,
                      config,
                      presetTemplate.config?.postHandler
                  )
                : undefined

            let streamPromise: Promise<void> = Promise.resolve()
            if (config.streamResponse) {
                const isEditMessage =
                    session.bot.editMessage != null &&
                    session.bot.platform !== 'onebot'

                if (isEditMessage) {
                    streamPromise = setupEditMessageStream(
                        context,
                        session,
                        config,
                        bufferText
                    )
                } else {
                    streamPromise = setupRegularMessageStream(
                        context,
                        config,
                        config.splitMessage
                            ? bufferText.splitByPunctuations()
                            : bufferText.splitByMarkdown()
                    )
                }
            }

            let responseMessage: Message

            inputMessage.conversationId = room.conversationId
            inputMessage.name =
                session.author?.name ?? session.author?.id ?? session.username

            const requestId = createRequestId(
                session,
                room,
                context.options.messageId
            )

            const chatCallbacks = createChatCallbacks(
                context,
                session,
                config,
                bufferText
            )

            try {
                ;[responseMessage] = await Promise.all([
                    ctx.chatluna.chat(
                        session,
                        room,
                        inputMessage,
                        chatCallbacks,
                        config.streamResponse,
                        {
                            prompt: getMessageContent(originContent),
                            ...getSystemPromptVariables(session, config, room)
                        },
                        postHandler,
                        requestId
                    ),
                    streamPromise
                ])
            } catch (e) {
                if (e?.message?.includes('output values have 1 keys')) {
                    throw new ChatLunaError(
                        ChatLunaErrorCode.MODEL_RESPONSE_IS_EMPTY
                    )
                } else {
                    throw e
                }
            }

            if (!config.streamResponse) {
                context.options.responseMessage = responseMessage
            } else {
                context.options.responseMessage = null
                context.message = null
            }

            await updateChatTime(ctx, room)

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('lifecycle-request_model')
}

export function getRequestId(session: Session, room: ConversationRoom) {
    const userKey =
        session.userId +
        '-' +
        (session.guildId ?? '') +
        '-' +
        room.conversationId

    return requestIdCache.get(userKey)
}

export function createRequestId(
    session: Session,
    room: ConversationRoom,
    requestId: string = randomUUID()
) {
    const userKey =
        session.userId +
        '-' +
        (session.guildId ?? '') +
        '-' +
        room.conversationId

    requestIdCache.set(userKey, requestId)

    return requestId
}

function createChatCallbacks(
    context: ChainMiddlewareContext,
    session: Session,
    config: Config,
    bufferText: StreamingBufferText
) {
    return {
        'llm-new-chunk': createChunkHandler(context, bufferText),
        'llm-queue-waiting': createQueueWaitingHandler(context),
        'llm-call-tool': createToolCallHandler(context, config),
        'llm-used-token-count': createTokenCountHandler(
            context,
            session,
            config
        )
    }
}

function createChunkHandler(
    context: ChainMiddlewareContext,
    bufferText: StreamingBufferText
) {
    let firstResponse = true

    return async (chunk: BaseMessageChunk) => {
        if (chunk == null) {
            await bufferText.end()
            return
        }

        await bufferText.writeChunk(chunk)

        if (firstResponse === true) {
            firstResponse = false
            try {
                await context?.recallThinkingMessage()
            } finally {
                firstResponse = false
            }
        }
    }
}

function createQueueWaitingHandler(context: ChainMiddlewareContext) {
    return async (count: number) => {
        context.options.queueCount = count
    }
}

function createToolCallHandler(
    context: ChainMiddlewareContext,
    config: Config
) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (tool: string, arg: any, log: string) => {
        logger.debug(`Call tool: ${tool} with ${JSON.stringify(arg)}`)

        if (!(log.includes('Invoking') && log.includes('with'))) {
            context.send(log)
            return
        }

        if (!config.showThoughtMessage) {
            return
        }

        context.send(formatToolCall(tool, arg, log))
    }
}

function createTokenCountHandler(
    context: ChainMiddlewareContext,
    session: Session,
    config: Config
) {
    return async (tokens: number) => {
        if (config.authSystem !== true) {
            return
        }

        const balance = await context.ctx.chatluna_auth.calculateBalance(
            session,
            parseRawModelName(context.options.room.model)[0],
            tokens
        )

        logger.debug(`Current balance: ${balance}`)
    }
}

async function processUserPrompt(
    config: Config,
    presetTemplate: PresetTemplate,
    session: Session,
    originContent: MessageContent,
    room: ConversationRoom
) {
    if (typeof originContent === 'string') {
        return await formatUserPromptString(
            config,
            presetTemplate,
            session,
            originContent,
            room
        ).then((result) => result.text)
    }

    const sortedContent = sortContentByType(originContent)
    return await Promise.all(
        sortedContent.map(async (message) =>
            message.type === 'text'
                ? {
                      type: 'text',
                      text: await formatUserPromptString(
                          config,
                          presetTemplate,
                          session,
                          message.text,
                          room
                      ).then((result) => result.text)
                  }
                : message
        )
    )
}

function sortContentByType(content: MessageContentComplex[]) {
    return content.sort((a, b) =>
        a.type === 'text'
            ? -1
            : b.type === 'text'
              ? 1
              : a.type < b.type
                ? -1
                : 1
    )
}

function setupRegularMessageStream(
    context: ChainMiddlewareContext,
    config: Config,
    textStream: ReadableStream<Element>
) {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise<void>(async (resolve) => {
        const reader = textStream.getReader()
        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                await sendMessage(context, value, config)
            }
        } catch (error) {
            logger.error('Error in message stream:', error)
        } finally {
            reader.releaseLock()
            resolve()
        }
    })
}

function setupEditMessageStream(
    context: ChainMiddlewareContext,
    session: Session,
    config: Config,
    bufferText: StreamingBufferText
) {
    const cachedStream = bufferText.getCached()
    // eslint-disable-next-line no-async-promise-executor
    return new Promise<void>(async (resolve) => {
        const { ctx } = context
        let messageId: string | null = null
        const messageQueue = new MessageEditQueue()

        const reader = cachedStream.getReader()
        try {
            while (true) {
                const { done, value } = await reader.read()

                if (done) break

                let processedElements = value
                if (config.censor) {
                    processedElements = await ctx.censor
                        .transform(value, session)
                        .then((result) => result)
                }

                if (messageId == null) {
                    messageId = await sendInitialMessage(
                        session,
                        processedElements
                    )
                } else {
                    await messageQueue.enqueue(
                        messageId,
                        session,
                        processedElements
                    )
                }
            }
            messageQueue.finish()
        } catch (error) {
            logger.error('Error in edit message stream:', error)
        } finally {
            reader.releaseLock()
            resolve()
        }
    })
}

async function renderMessageWithCensor(
    context: ChainMiddlewareContext,
    message: Message,
    config: Config
) {
    const renderedMessage = await renderMessage(
        context.ctx,
        message,
        context.options.renderOptions
    )

    if (config.censor) {
        for (const key in renderedMessage) {
            renderedMessage[key] = await context.ctx.censor.transform(
                renderedMessage[key],
                context.session
            )
        }
    }

    return renderedMessage
}

async function sendMessage(
    context: ChainMiddlewareContext,
    text: Fragment,
    config: Config
) {
    if (text == null || (typeof text === 'string' && text.trim() === '')) {
        return
    }

    const renderedMessage = await renderMessageWithCensor(
        context,
        {
            content: typeof text === 'string' ? text : text.toString()
        },
        config
    )

    await context.send(renderedMessage)
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        request_model: never
    }

    interface ChainMiddlewareContextOptions {
        responseMessage?: Message
        inputMessage?: Message
        queueCount?: number
    }
}
