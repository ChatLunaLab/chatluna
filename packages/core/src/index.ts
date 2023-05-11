import { Context, ForkScope, Logger } from "koishi";

import { createLogger, setLoggerLevel } from "@dingyi222666/chathub-llm-core/lib/utils/logger";
import { request } from "@dingyi222666/chathub-llm-core/lib/utils/request";
import { Config } from './config';
import { ChatChain } from './chain';
import { ChatHubService } from './services/chat';



export const name = "@dingyi222666/chathub"
export const using = ['cache']
export let chain: ChatChain

const logger = createLogger("@dingyi222666/chathub")

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

        chain = new ChatChain(ctx, config)

        forkScopes.push(ctx.plugin(ChatHubService))
    })


    // 释放资源
    ctx.on("dispose", () => {
        forkScopes.forEach(scope => scope.dispose())
    })
}
