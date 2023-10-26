import { Context, Session, sleep } from 'koishi'
import { Config } from '../config'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../chains/chain'
import { createLogger } from '../utils/logger'
import { Message } from '../types'
import { formatPresetTemplateString } from '../llm-core/prompt'
import { renderMessage } from './render_message'
import { SimpleSubscribeFlow } from '../utils/flow'
import { ChatHubError, ChatHubErrorCode } from '../utils/error'
import { parseRawModelName } from '../llm-core/utils/count_tokens'
const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('request_model', async (session, context) => {
            const { room, inputMessage } = context.options

            const presetTemplate = await ctx.chathub.preset.getPreset(
                room.preset
            )

            if (presetTemplate.formatUserPromptString != null) {
                context.message = formatPresetTemplateString(
                    presetTemplate.formatUserPromptString,
                    {
                        sender: session.username,
                        prompt: context.message as string,
                        date: new Date().toLocaleString()
                    }
                )
            }

            const bufferText: BufferText = {
                text: '',
                diffText: '',
                bufferText: '',
                lastText: '',
                finish: false
            }

            const flow = new SimpleSubscribeFlow<string>()
            let firstResponse = true

            flow.subscribe(async (text) => {
                bufferText.text = text
                await handleMessage(
                    session,
                    config,
                    context,
                    bufferText,
                    async (text) => {
                        await sendMessage(context, text)
                    }
                )
            })

            setTimeout(async () => {
                await flow.run()
            }, 0)

            let responseMessage: Message

            inputMessage.conversationId = room.conversationId
            inputMessage.name =
                session.author?.name ?? session.author?.id ?? session.username

            try {
                responseMessage = await ctx.chathub.chat(
                    session,
                    room,
                    inputMessage,
                    {
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        'llm-new-token': async (token) => {
                            if (token === '') {
                                return
                            }

                            if (firstResponse) {
                                firstResponse = false
                                await context?.recallThinkingMessage()
                            }

                            await flow.push(token)
                        },
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        'llm-queue-waiting': async (count) => {
                            context.options.queueCount = count
                        },
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        'llm-used-token-count': async (tokens) => {
                            if (config.authSystem !== true) {
                                return
                            }
                            const balance =
                                await ctx.chathub_auth.calculateBalance(
                                    session,
                                    parseRawModelName(room.model)[0],
                                    tokens
                                )

                            logger.debug(`current balance: ${balance}`)
                        }
                    },
                    config.streamResponse
                )
            } catch (e) {
                if (e.message.includes('output values have 1 keys')) {
                    throw new ChatHubError(
                        ChatHubErrorCode.MODEL_RESPONSE_IS_EMPTY
                    )
                } else {
                    throw e
                }
            } finally {
                await flow.stop()
            }

            if (
                !config.streamResponse ||
                room.chatMode === 'plugin' ||
                (room.chatMode === 'browsing' && !room.model.includes('0613'))
            ) {
                context.options.responseMessage = responseMessage
            } else {
                bufferText.finish = true

                await flow.stop()
                await flow.run(1)

                context.options.responseMessage = null
                context.message = null
            }

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('lifecycle-request_model')

    const sendMessage = async (
        context: ChainMiddlewareContext,
        text: string
    ) => {
        if (text == null || text.trim() === '') {
            return
        }
        const renderedMessage = await renderMessage(
            {
                content: text
            },
            context.options.renderOptions
        )

        await context.send(renderedMessage)
    }
}

async function handleMessage(
    session: Session,
    config: Config,
    context: ChainMiddlewareContext,
    bufferMessage: BufferText,
    sendMessage: (text: string) => Promise<void>
) {
    let {
        messageId: currentMessageId,
        lastText,
        bufferText,
        diffText,
        text,
        finish
    } = bufferMessage

    diffText = text.substring(Math.min(text.length, lastText.length))

    /* logger.debug(
        `diffText: ${diffText}, bufferText: ${bufferText}, lastText: ${lastText}, text.length: ${text.length},last.length: ${lastText.length}`
    ) */

    if (session.bot.editMessage) {
        if (currentMessageId == null) {
            await sleep(100)
            if (bufferMessage.messageId != null) {
                return
            }
            const messageIds = await session.send(text)
            currentMessageId = messageIds[0]
            bufferMessage.messageId = currentMessageId
            await sleep(100)
        } else if (lastText !== text && diffText !== '') {
            try {
                await session.bot.editMessage(
                    session.channelId,
                    currentMessageId,
                    text
                )
            } catch (e) {
                logger.error(e)
            }
        }

        if (text.startsWith(bufferMessage.lastText)) {
            bufferMessage.lastText = text
        }

        return
    }

    // 对于不支持的，我们积攒一下进行一个发送

    const punctuations = ['，', '.', '。', '!', '！', '?', '？']

    const sendTogglePunctuations = ['.', '!', '！', '?', '？']

    if (
        finish &&
        (diffText.trim().length > 0 || bufferText.trim().length > 0)
    ) {
        bufferText = bufferText + diffText

        await sendMessage(bufferText)
        bufferText = ''

        bufferMessage.lastText = text
        return
    }

    let lastChar = ''

    if (config.splitMessage) {
        for (const char of diffText) {
            if (!punctuations.includes(char)) {
                bufferText += char
                continue
            }

            if (bufferText.trim().length > 0) {
                await sendMessage(
                    bufferText.trimStart() +
                        (sendTogglePunctuations.includes(char) ? char : '')
                )
            }
            bufferText = ''
        }
    } else {
        // match \n\n like markdown

        for (const char of diffText) {
            if (char === '\n' && lastChar === '\n') {
                if (bufferText.trim().length > 0) {
                    await sendMessage(bufferText.trimStart().trimEnd())
                }
                bufferText = ''
            } else {
                bufferText += char
            }
            lastChar = char
        }
    }

    bufferMessage.messageId = currentMessageId
    bufferMessage.diffText = ''
    bufferMessage.bufferText = bufferText
    bufferMessage.lastText = text
}

interface BufferText {
    messageId?: string
    text: string
    bufferText: string
    diffText: string
    lastText: string
    finish: boolean
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        request_model: never
    }

    interface ChainMiddlewareContextOptions {
        responseMessage?: Message
        inputMessage?: Message
        queueCount?: number
    }
}
