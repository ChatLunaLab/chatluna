import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'



const logger = createLogger()

export function apply(ctx: Context, config: Config) {
    config.chatConcurrentMaxSize = 1
}

export interface Config extends ChatHubPlugin.Config {
    formatMessages: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,


    Schema.object({
        formatMessages: Schema.boolean().description('是否使用历史聊天消息').default(true),
    }).description('对话设置'),
])



export const using = ['chathub']


export const name = "chathub-lmsys-adapter"