import { Service, Schema, Context, Logger, Session, ForkScope } from "koishi";
import { Config } from "./config"
import { LLMInjectService } from "./services/injectService"
import { LLMChatService } from './services/chatService';
import { Chat, checkBasicCanReply, checkCooldownTime, createSenderInfo, readChatMessage, replyMessage, createConversationConfig } from "./chat";
import { ChatLimitCache, ChatLimit } from './cache';
import { createLogger, setLoggerLevel } from './logger';
import commands from "./commands"

export * from "./config"
export * from "./types"
export * from "./services/chatService"
export * from "./services/injectService"
export * from "./logger"

export const name = "@dingyi222666/chathub"
export const using = ['cache']

const logger = createLogger("@dingyi222666/chathub")

let chat: Chat
let chatLimitCache: ChatLimitCache


export function apply(ctx: Context, config: Config) {

    if (config.isLog) {
        setLoggerLevel(Logger.DEBUG)
    }

    const forkScopes: ForkScope[] = []

    ctx.on("ready", async () => {

        forkScopes.push(ctx.plugin(LLMInjectService))
        forkScopes.push(ctx.plugin(LLMChatService, config))

        chatLimitCache = new ChatLimitCache(ctx, config)
        chat = new Chat(ctx, config)

        commands(ctx, config, chat)
    })


    // 释放资源
    ctx.on("dispose", () => {
        forkScopes.forEach(scope => scope.dispose())
    })

    ctx.middleware(async (session, next) => {

        if (chat === null) {
            replyMessage(session, '插件还没初始化好，请稍后再试')
            return next()
        }

        // 禁止套娃

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
                const result = await chat.chat(input, config, senderId, senderName)

                return result
            } catch (e) {
                logger.error(e)
            }

            return null
        }, chatLimitCache, session, senderId)

        if (chatLimitResult == null) {
            logger.debug(`[chat-limit] ${senderName}(${senderId}): ${input}`)
            return next()
        }

        chatLimitResult.forEach((result) => {
            replyMessage(session, result)
        })
        return null
    })



}