import { Context, ForkScope, Logger } from "koishi";

import { createLogger, setLoggerLevel } from "@dingyi222666/chathub-llm-core/lib/utils/logger";
import { request } from "@dingyi222666/chathub-llm-core/lib/utils/request";
import { Config } from './config';
import { ChatChain } from './chain';
import { ChatHubService } from './services/chat';
import { middleware } from "./middleware";
import { Cache } from "./cache"

export * from './config'
export const name = "@dingyi222666/chathub"
export const using = ['cache', 'database']

export const usage = `
## chathub v1.0.0 更新

# 本次更新为重大更新，不兼容旧版本，请卸载后重新配置

`

let _chain: ChatChain
let _keysCache: Cache<"chathub/keys", string>

export const getChatChain = () => _chain
export const getKeysCache = () => _keysCache

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

        _chain = new ChatChain(ctx, config)

        forkScopes.push(ctx.plugin(ChatHubService))

        middleware(ctx, config)
    })


    // 释放资源
    ctx.on("dispose", () => {
        forkScopes.forEach(scope => scope.dispose())
    })

}
