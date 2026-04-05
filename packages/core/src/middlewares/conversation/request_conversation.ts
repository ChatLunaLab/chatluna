import { Context, Element, Fragment, Logger, Session } from 'koishi'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
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
import { Message } from '../../types'
import { renderMessage } from '../chat/render_message'
import {
    formatToolCall,
    formatUserPromptString,
    getMessageContent,
    getSystemPromptVariables,
    PresetPostHandler
} from 'koishi-plugin-chatluna/utils/string'
import type { ConversationRecord } from '../../services/conversation_types'
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
import { AgentAction } from 'koishi-plugin-chatluna/llm-core/agent'

let logger: Logger

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    logger = createLogger(ctx)
    chain
        .middleware('request_conversation', async (session, context) => {
            const { inputMessage } = context.options
            const useRoutePresetLane =
                context.options.presetLane == null &&
                context.options.conversationId == null &&
                (context.command == null || context.command.length === 0)
            const resolved =
                await ctx.chatluna.conversation.ensureActiveConversation(
                    session,
                    {
                        conversationId: context.options.conversationId,
                        presetLane: context.options.presetLane,
                        useRoutePresetLane
                    }
                )
            const conversation = resolved.conversation

            context.options.conversationId = conversation.id
            context.options.resolvedConversation = conversation
            context.options.resolvedConversationContext = resolved

            const presetTemplate = ctx.chatluna.preset.getPreset(
                conversation.preset
            ).value

            if (presetTemplate == null) {
                throw new ChatLunaError(
                    ChatLunaErrorCode.PRESET_NOT_FOUND,
                    new Error(`Preset ${conversation.preset} not found`)
                )
            }

            const originContent = inputMessage.content

            if (presetTemplate.formatUserPromptString != null) {
                inputMessage.content = await processUserPrompt(
                    config,
                    presetTemplate,
                    session,
                    inputMessage.content,
                    conversation
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

            inputMessage.conversationId = conversation.id
            inputMessage.name =
                session.author?.name ?? session.author?.id ?? session.username

            const requestId = context.options.messageId

            const chatCallbacks = createChatCallbacks(
                context,
                config,
                bufferText
            )

            try {
                ;[responseMessage] = await Promise.all([
                    ctx.chatluna.conversationRuntime.chat(
                        session,
                        conversation,
                        inputMessage,
                        chatCallbacks,
                        config.streamResponse,
                        {
                            prompt: getMessageContent(originContent),
                            ...getSystemPromptVariables(
                                session,
                                config,
                                conversation
                            )
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

            await ctx.chatluna.conversation.touchConversation(conversation.id, {
                lastChatAt: new Date()
            })

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('lifecycle-request_conversation')
}

function createChatCallbacks(
    context: ChainMiddlewareContext,
    config: Config,
    bufferText: StreamingBufferText
) {
    return {
        'llm-new-chunk': createChunkHandler(context, bufferText),
        'llm-queue-waiting': createQueueWaitingHandler(context),
        'llm-call-tool': createToolCallHandler(context, config)
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
    return async (
        tool: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        arg: any,
        content: AgentAction['content'],
        log: string
    ) => {
        logger.debug(`Call tool: ${tool} with ${JSON.stringify(arg)}`)

        if (
            content != null &&
            ((typeof content === 'string' && content.trim().length > 0) ||
                (Array.isArray(content) && content.length > 0))
        ) {
            await sendRenderedMessage(
                context,
                {
                    content
                },
                config
            )

            return
        }

        if (!config.showThoughtMessage) {
            return
        }

        if (!(log.includes('Invoking') && log.includes('with'))) {
            await sendMessage(context, log, config)
            return
        }

        await sendMessage(context, formatToolCall(tool, arg, log), config)
    }
}

async function processUserPrompt(
    config: Config,
    presetTemplate: PresetTemplate,
    session: Session,
    originContent: MessageContent,
    conversation: Pick<
        ConversationRecord,
        'preset' | 'id' | 'updatedAt' | 'lastChatAt'
    >
) {
    if (typeof originContent === 'string') {
        return await formatUserPromptString(
            config,
            presetTemplate,
            session,
            originContent,
            conversation
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
                          conversation
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

async function setupRegularMessageStream(
    context: ChainMiddlewareContext,
    config: Config,
    textStream: ReadableStream<Element>
) {
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
    }
}

async function setupEditMessageStream(
    context: ChainMiddlewareContext,
    session: Session,
    config: Config,
    bufferText: StreamingBufferText
) {
    const cachedStream = bufferText.getCached()
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
                messageId = await sendInitialMessage(session, processedElements)
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
    }
}

async function renderMessageWithCensor(
    context: ChainMiddlewareContext,
    message: Message,
    config: Config
) {
    const renderedMessage = await renderMessage(context.ctx, message, {
        ...context.options.renderOptions,
        session: context.session
    })

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
    await sendRenderedMessage(
        context,
        {
            content: typeof text === 'string' ? text : text.toString()
        },
        config
    )
}

async function sendRenderedMessage(
    context: ChainMiddlewareContext,
    message: Message,
    config: Config
) {
    const { content } = message
    if (
        content == null ||
        (typeof content === 'string' && content.trim() === '') ||
        (Array.isArray(content) && content.length === 0)
    ) {
        return
    }

    const renderedMessage = await renderMessageWithCensor(
        context,
        message,
        config
    )

    await context.send(renderedMessage)
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        request_conversation: never
    }

    interface ChainMiddlewareContextOptions {
        responseMessage?: Message
        inputMessage?: Message
        queueCount?: number
    }
}
