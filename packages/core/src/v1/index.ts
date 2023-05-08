import { Context, ForkScope, Logger } from "koishi";

import { createLogger, setLoggerLevel } from "@dingyi222666/chathub-llm-core/src/utils/logger";
import { request } from "@dingyi222666/chathub-llm-core/src/utils/request";
import { Config } from '../config';
import { ChatChain } from './chain';



export const name = "@dingyi222666/chathub"
export const using = ['cache']
export let chain: ChatChain

const logger = createLogger("@dingyi222666/chathub")

export function apply(ctx: Context, config: Config) {

    if (config.isLog) {
        setLoggerLevel(Logger.DEBUG)
    }

    ctx.on("ready", async () => {
        // set proxy before init service

        if (config.isProxy) {
            request.globalProxyAdress = config.proxyAddress ?? ctx.http.config.proxyAgent

            logger.debug(`[proxy] ${config.proxyAddress}`)
        }

        chain = new ChatChain(ctx, config)
    })


}
