import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'
import { Claude2Client } from './client'
import { Claude2ClientConfig } from './types'


const logger = createLogger()

export function apply(ctx: Context, config: Config) {
    config.chatConcurrentMaxSize = 1

    const plugin = new ChatHubPlugin<Claude2ClientConfig, Config>(ctx, config, "claude2")

    ctx.on("ready", async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.cookies.map((apiKey) => {
                return {
                    apiKey: apiKey,
                    platform: "claude2",
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize,
                    formatMessages: config.formatMessages
                }
            })
        })

        await plugin.registerClient((_, clientConfig) => new Claude2Client(ctx, config, clientConfig))

        await plugin.initClients()
    })
}



//export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

export interface Config extends ChatHubPlugin.Config {
    cookies: string[],

    formatMessages: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,

    Schema.object({
        cookies: Schema.array(
            Schema.string().role('secret').required()
        ).description('Claude 账号的 Cookie')
    }).description('请求设置'),

    Schema.object({
        formatMessages: Schema.boolean().description('是否使用历史聊天消息').default(false),
    }).description('对话设置'),


])



export const using = ['chathub']

export const name = "chathub-claude2-adapter"