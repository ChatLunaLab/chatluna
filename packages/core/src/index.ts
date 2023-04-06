import { Service, Schema, Context, Logger } from "koishi";
import { Config } from "./config"
import { LLMInjectService } from "./services/injectService"


export * from "./config"
export * from "./types"
export * from "./services/chatService"
export * from "./services/injectService"


export const name = "@dingyi222666/chathub"
export const using = ['cache']
const logger = new Logger("@dingyi222666/chathub")

export function apply(ctx: Context, config: Config) {
  ctx.plugin(LLMInjectService)
  logger.info(config.chatLimit)
}


