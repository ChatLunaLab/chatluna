import { Context, Session } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareContext, ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { Message, RenderOptions } from '../types';
import { formatPresetTemplateString, loadPreset } from '../llm-core/prompt'
import { getPresetInstance } from '..';
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

        let bufferMessage: BufferMessage = {
            message: "",
            sendedMessage: "",
            finish: false
        }


        const responseMessage = await ctx.chathub.chat(
            room,
            {
                name: session.username,
                content: context.message as string
            }, {
            ["llm-new-token"]: async (token) => {
                bufferMessage.message = token
                bufferMessage = await handleMessage(session, config, context, bufferMessage)
            },
            ["llm-queue-waiting"]: async (count) => {
                context.options.queueCount = count
            },
        }, config.streamResponse)


        if (!config.streamResponse) {
            context.options.responseMessage = responseMessage
        } else {
            bufferMessage.finish = true
            bufferMessage = await handleMessage(session, config, context, bufferMessage)
        }

        logger.debug(`[request_model] responseMessage: ${context.options.responseMessage.content}`)

        return ChainMiddlewareRunStatus.CONTINUE
    }).after("lifecycle-request_model")
}



async function handleMessage(session: Session, config: Config, context: ChainMiddlewareContext, bufferMessage: BufferMessage) {

    await context?.recallThinkingMessage()

    let { messageId: currentMessageId, sendedMessage, message, finish } = bufferMessage

    if (session.bot.editMessage) {
        if (currentMessageId == null) {
            const messageIds = await session.send(message)
            currentMessageId = messageIds[0]
        } else {
            await session.bot.editMessage(session.channelId, currentMessageId, message)
        }

        return bufferMessage
    }

    // 对于不支持的，我们积攒一下进行一个发送
    const diff = message.substring(sendedMessage.length)


    if (config.splitMessage) {
        const splitted = splitSentence(diff)

        const last = splitted.pop()

        for (const message of splitted) {
            await session.send(message)
        }

        sendedMessage = sendedMessage + diff.substring(0, diff.length - last.length)

        if (finish) {
            await session.send(last)
        }
    } else {
        const splitted = diff.split("\n\n")

        // 特别的，最后一段可能没完全，所以我们不发送

        const last = splitted.pop()

        for (const message of splitted) {
            await session.send(message)
        }

        sendedMessage = splitted.join("\n\n")

        if (finish) {
            await session.send(last)
        }
    }

    sendedMessage = message

    bufferMessage = {
        messageId: currentMessageId,
        message: diff,
        sendedMessage,
        finish
    }

    return bufferMessage
}

// 定义一个函数，用于分割句子
function splitSentence(sentence: string): string[] {
    // 定义一个正则表达式，用于匹配中英文的标点符号
    const regex = /([，。？！；：,?!;:])/g;
    // 定义一个数组，存放所有可能出现的标点符号
    const punctuations = ["，", "。", "？", "！", "；", "：", ",", "?", "!", ";", ":"];
    // 使用split方法和正则表达式来分割句子，并过滤掉空字符串
    let result = sentence.split(regex).filter((s) => s !== "");

    // 定义一个新的数组，用于存放最终的结果
    const final: string[] = [];
    // 遍历分割后的数组
    for (let i = 0; i < result.length; i++) {
        // 如果当前元素是一个标点符号
        if (punctuations.includes(result[i])) {
            final[final.length - 1] = final[final.length - 1].trim() + result[i]
        }
        // 否则，如果当前元素不是空格
        else if (result[i] !== " ") {
            // 把当前元素加入到最终的数组中
            final.push(result[i]);
        }
    }

    const replacePunctuations = ["，", "。", "、", ",", "\"", "'", ":"]

    return final.filter(it => !punctuations.some(char => char === it)).map(text => {
        const lastChar = text[text.length - 1]

        if (replacePunctuations.some(char => char === lastChar)) {
            return text.slice(0, text.length - 1)
        }

        return text
    })
}


interface BufferMessage {
    messageId?: string
    message: string
    sendedMessage: string
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