import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'



const logger = createLogger()

export function apply(ctx: Context, config: Config) {
    config.chatConcurrentMaxSize = 1
}



//export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

export interface Config extends ChatHubPlugin.Config {
    cookie: string,

    formatMessages: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,

    Schema.object({
        cookie: Schema.string().role('secret').description('Claude 账号的 Cookie').default("")
    }).description('请求设置'),

    Schema.object({
        formatMessages: Schema.boolean().description('是否使用历史聊天消息').default(false),
    }).description('对话设置'),


])



export const using = ['chathub']

export const name = "chathub-claude2-adapter"