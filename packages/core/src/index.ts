import { Context, ForkScope, Logger } from "koishi";
import { Config } from "./config"
import { LLMInjectService } from "./services/injectService"
import { LLMChatService } from './services/chatService';
import {
    Chat,
    checkBasicCanReply,
    checkCooldownTime,
    createSenderInfo,
    readChatMessage,
    replyMessage,
    runPromiseByQueue
} from "./chat";
import { createLogger, setLoggerLevel } from './utils/logger';
import commands from "./commands"
import { request } from './utils/request';
import { readFileSync } from 'fs';

export * from "./config"
export * from "./types"
export * from "./services/chatService"
export * from "./services/injectService"
export * from "./utils/logger"
export * from "./utils/request"

export const name = "@dingyi222666/chathub"
export const using = ['cache']
// parentDir/README.md
export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

const logger = createLogger("@dingyi222666/chathub")

let chat: Chat


export function apply(ctx: Context, config: Config) {

    if (config.isLog) {
        setLoggerLevel(Logger.DEBUG)
    }

    const forkScopes: ForkScope[] = []

    ctx.on("ready", async () => {
        // set proxy before init service

        if (config.isProxy) {
            request.globalProxyAdress = config.proxyAddress ?? ctx.http.config.proxyAgent

            logger.debug(`[proxy] ${config.proxyAddress}`)
        }

        forkScopes.push(ctx.plugin(LLMInjectService))
        forkScopes.push(ctx.plugin(LLMChatService, config))

        chat = new Chat(ctx, config)

        commands(ctx, config, chat)
    })


    // 释放资源
    ctx.on("dispose", () => {
        forkScopes.forEach(scope => scope.dispose())
    })

    ctx.middleware(async (session, next) => {

        if (chat === null) {
            await replyMessage(session, '插件还没初始化好，请稍后再试')
            return next()
        }

        if (!checkBasicCanReply(ctx, session, config)) return next()

        if (!checkCooldownTime(session, config)) return next()

        // 检测输入是否能聊起来
        let input = readChatMessage(session)

        logger.debug(`[chat-input] ${session.userId}(${session.username}): ${input}`)

        if (input.trim() === '') return next()

        const { senderId, senderName } = createSenderInfo(session, config)

        const chatLimitResult = await chat.withChatLimit(async () => {

            logger.debug(`[chat] ${senderName}(${senderId}): ${input}`)

            try {
                return await chat.chat(input, config, senderId, senderName)
            } catch (e) {
                logger.error(e)
            }

            return null
        }, session, senderId)

        if (chatLimitResult == null) {
            logger.debug(`[chat-limit/error] ${senderName}(${senderId}): ${input}`)
            return next()
        }

        await runPromiseByQueue(chatLimitResult.map((result) => replyMessage(session, result)))

        return null
    })

}
