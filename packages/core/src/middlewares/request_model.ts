import { Context, Logger, Session, sleep } from 'koishi'
import { formatPresetTemplateString } from 'koishi-plugin-chatluna/llm-core/prompt'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatLunaError, ChatLunaErrorCode } from 'koishi-plugin-chatluna/utils/error'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { Config } from '../config'
import { Message } from '../types'
import { SubscribeFlow } from '../utils/flow'
import { renderMessage } from './render_message'
import { getNotEmptyString } from 'koishi-plugin-chatluna/utils/string'

let logger: Logger

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    logger = createLogger(ctx)
    chain
        .middleware('request_model', async (session, context) => {
            const { room, inputMessage } = context.options

            const presetTemplate = await ctx.chatluna.preset.getPreset(
                room.preset
            )

            function getCurrentWeekday() {
                const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const currentDate = new Date();
                return daysOfWeek[currentDate.getDay()];
            }

            if (presetTemplate.formatUserPromptString != null) {

                context.message = formatPresetTemplateString(
                    presetTemplate.formatUserPromptString,
                    {
                        is_group: (!session.isDirect || session.guildId != null).toString(),
                        is_private: session.isDirect?.toString(),
                        sender_id: session.author?.user?.id ?? session.event?.user?.id ?? '0',

                        sender: getNotEmptyString(
                            session.author?.nick,
                            session.author?.name,
                            session.event.user?.name,
                            session.username
                        ),
                        prompt: inputMessage.content as string,
                        date: new Date().toLocaleString(), // 可以根据需要调整日期格式
                        weekday: getCurrentWeekday()
                    }
                );

                inputMessage.content = context.message as string;
            }

            const bufferText: BufferText = {
                text: '',
                diffText: '',
                bufferText: '',
                lastText: '',
                finish: false
            }

            const flow = new SubscribeFlow<string>()
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
                responseMessage = await ctx.chatluna.chat(
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
                        'llm-call-tool': async (tool, arg) => {
                            if (!config.showThoughtMessage) {
                                return
                            }

                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            let rawArg = arg as any

                            if (
                                rawArg.input &&
                                Object.keys(rawArg).length === 1
                            ) {
                                rawArg = rawArg.input
                            }

                            if (typeof rawArg !== 'string') {
                                rawArg = JSON.stringify(rawArg, null, 2) || ''
                            }

                            context.send(
                                `{\n  tool: '${tool}',\n  arg: '${rawArg}'\n}`
                            )
                        },
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        'llm-used-token-count': async (tokens) => {
                            if (config.authSystem !== true) {
                                return
                            }
                            const balance =
                                await ctx.chatluna_auth.calculateBalance(
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
                if (e?.message?.includes('output values have 1 keys')) {
                    throw new ChatLunaError(
                        ChatLunaErrorCode.MODEL_RESPONSE_IS_EMPTY
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
                room.chatMode === 'browsing' ||
                room.chatMode === 'knowledge-chat'
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

        if (config.censor) {
            for (const key in renderedMessage) {
                renderedMessage[key] = await ctx.censor.transform(
                    renderedMessage[key],
                    context.session
                )
            }
        }

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
            await sleep(500)
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
