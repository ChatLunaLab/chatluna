import { Context, ForkScope, Logger } from "koishi";
import { Config } from "./config"
import { LLMInjectService } from "./services/injectService"
import { LLMChatService } from './services/chatService';
import {
    Chat,
    buildTextElement,
    replyMessage} from "./chat";
import { createLogger, setLoggerLevel } from './utils/logger';
import commands from "./commands"
import { request } from './utils/request';


export * from "./config"
export * from "./types"
export * from "./services/chatService"
export * from "./services/injectService"
export * from "./utils/logger"
export * from "./utils/request"
export * from "./chat"

export const name = "@dingyi222666/chathub"
export const using = ['cache']

const logger = createLogger("@dingyi222666/chathub")

let chat: Chat


export function apply(ctx: Context, config: Config) {

    if (config.isLog) {
        setLoggerLevel(Logger.DEBUG)
    }

    const forkScopes: ForkScope[] = []

    logger.debug(`[config] ${JSON.stringify(config.outputMode)}`)

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
            await replyMessage(ctx, session, buildTextElement('插件还没初始化好，请稍后再试'))
            return next()
        }


        const successful = await chat.chat({
            session,
            config,
            ctx,
        })

        if (successful) {
            return null
        }

        return next()
    })

}
