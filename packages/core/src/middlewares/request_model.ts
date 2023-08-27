import { Context, Session } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { Message, RenderOptions } from '../types';
import { formatPresetTemplateString, loadPreset } from '../llm-core/prompt'
import { getPresetInstance } from '..';
import { ObjectLock } from '../utils/lock';
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

        const lock = new ObjectLock()

        const responseMessage = await ctx.chathub.chat(
            room,
            {
                name: session.username,
                content: context.message as string
            }, {
            ["llm-new-token"]: async (token) => {
                if (token === "") {
                    return
                }

                if (bufferText.text === token) {
                    // 抖动
                    return
                }

                await lock.lock()
                bufferText.text = token
                bufferText = await handleMessage(session, config, context, bufferText)
                await lock.unlock()
            },
            ["llm-queue-waiting"]: async (count) => {
                context.options.queueCount = count
            },
        }, config.streamResponse)


        if (!config.streamResponse) {
            context.options.responseMessage = responseMessage
        } else {
            bufferText.finish = true
            bufferText = await handleMessage(session, config, context, bufferText)

            context.options.responseMessage = null
            context.message = null
        }



        return ChainMiddlewareRunStatus.CONTINUE
    }).after("lifecycle-request_model")
}



async function handleMessage(session: Session, config: Config, context: ChainMiddlewareContext, bufferMessage: BufferText) {

    await context?.recallThinkingMessage()

    let { messageId: currentMessageId, lastText, bufferText, diffText, text, finish } = bufferMessage

    if (session.bot.editMessage) {
        if (currentMessageId == null) {
            const messageIds = await session.sendQueued(text)
            currentMessageId = messageIds[0]
        } else {
            await session.bot.editMessage(session.channelId, currentMessageId, text)
        }

        return bufferMessage
    }

    // 对于不支持的，我们积攒一下进行一个发送

    const punctuations = ["，", "。", "？", "！", "；", ",", "?", "!", ";"];

    diffText = text.substring(lastText.length)


    if (finish) {
        logger.debug(`send: ${session.username}(${session.userId}): ${text}`)
        if (bufferText.length > 0) {
            await session.sendQueued(bufferText)
            bufferText = ""
        }
        return bufferMessage
    }

    if (config.splitMessage) {
        for (const char of diffText) {
            if (punctuations.includes(char)) {
                logger.debug(`send: ${session.username}(${session.userId}): ${bufferText + char}`)
                await session.sendQueued(bufferText)
                bufferText = ""
            } else {
                bufferText += char
            }
        }

    } else {
        /*   const splitted = diff.split("\n\n")
  
          // 特别的，最后一段可能没完全，所以我们不发送
  
          const last = splitted.pop()
  
          for (const message of splitted) {
              await session.send(message)
          }
  
          sendedMessage = splitted.join("\n\n")
  
          if (finish) {
              await session.send(last)
          } */
    }


    bufferMessage = {
        messageId: currentMessageId,
        text,
        diffText,
        bufferText,
        lastText: text,
        finish
    }

    return bufferMessage
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