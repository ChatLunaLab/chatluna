import { Context, Session, sleep } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { Message, RenderOptions } from '../types';
import { formatPresetTemplateString, loadPreset } from '../llm-core/prompt'
import { getPresetInstance } from '..';
import { ObjectLock } from '../utils/lock';
import { renderMessage } from './render_message';
import { transformAndEscape } from '../renders/text';
import { SimpleSubscribeFlow } from '../utils/flow';
import { ChatHubError } from '../utils/error';
const logger = createLogger()


export function apply(ctx: Context, config: Config, chain: ChatChain) {

    chain.middleware("request_model", async (session, context) => {

        const room = context.options.room

        const presetTemplate = await getPresetInstance().getPreset(room.preset)

        if (presetTemplate.formatUserPromptString != null) {
            context.message = formatPresetTemplateString(presetTemplate.formatUserPromptString, {
                sender: session.username,
                prompt: context.message as string,
                date: new Date().toLocaleString(),
            })
        }

        let bufferText: BufferText = {
            text: "",
            diffText: "",
            bufferText: "",
            lastText: "",
            finish: false
        }

        const flow = new SimpleSubscribeFlow<string>()
        let firstResponse = true

        flow.subscribe(async (text) => {
            bufferText.text = text
            await handleMessage(session, config, context, bufferText, async (text) => { await sendMessage(context, text) })
        })

        setTimeout(async () => {
            await flow.run()
        }, 0)


        let responseMessage: Message

        try {
            responseMessage = await ctx.chathub.chat(
                room,
                {
                    name: session.username,
                    content: context.message as string
                }, {
                ["llm-new-token"]: async (token) => {
                    logger.debug(`[llm-new-token] ${token}`)
                    if (token === "") {
                        return
                    }

                    if (firstResponse) {
                        firstResponse = false
                        await context?.recallThinkingMessage()
                    }

                    await flow.push(token)
                },
                ["llm-queue-waiting"]: async (count) => {
                    context.options.queueCount = count
                },
            }, config.streamResponse)

        } catch (e) {
            throw e
        } finally {
            await flow.stop()
        }

        if (!config.streamResponse) {
            context.options.responseMessage = responseMessage
        } else {
            bufferText.finish = true

            await flow.stop()
            await flow.run(1)

            context.options.responseMessage = null
            context.message = null
        }


        return ChainMiddlewareRunStatus.CONTINUE
    }).after("lifecycle-request_model")


    const sendMessage = async (context: ChainMiddlewareContext, text: string) => {
        const renderedMessage = await renderMessage({
            content: text
        }, context.options.renderOptions)

        await context.send(renderedMessage)
    }
}



async function handleMessage(session: Session, config: Config, context: ChainMiddlewareContext, bufferMessage: BufferText, sendMessage: (text: string) => Promise<void>) {
    let { messageId: currentMessageId, lastText, bufferText, diffText, text, finish } = bufferMessage

    diffText = text.substring(lastText.length)

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
        } else if (lastText !== text && diffText !== "") {
            try {
                await session.bot.editMessage(session.channelId, currentMessageId, text)
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

    const punctuations = ["，", "。", "？", "！", "；", ",", "?", "!", ";"];

    if (finish) {
        if (bufferText.trim().length > 0) {
            await sendMessage(bufferText)
            bufferText = ""
        }
        bufferMessage.lastText = text
        return
    }

    if (config.splitMessage) {
        for (const char of diffText) {
            if (punctuations.includes(char)) {
                logger.debug(`send: ${bufferText + char}`)
                await sendMessage(bufferText)
                bufferText = ""
            } else {
                bufferText += char
            }
        }
    } else {
        // match \n\n like markdown

        let lastChar = ""

        for (const char of diffText) {
            if (char === "\n" && lastChar === "\n") {
                logger.debug(`send: ${bufferText + char}`)
                await sendMessage(bufferText)
                bufferText = ""
            } else {
                bufferText += char
            }
            lastChar = char
        }
    }

    bufferMessage.messageId = currentMessageId
    bufferMessage.diffText = diffText
    bufferMessage.bufferText = bufferText
    bufferMessage.lastText = text


    return
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
        "request_model": never
    }

    interface ChainMiddlewareContextOptions {
        responseMessage?: Message
        queueCount?: number
    }
}