import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { Context, Schema } from 'koishi'
import { LMSYSClient } from './client'
import { LmsysClientConfig } from './types'

const logger = createLogger()

export function apply(ctx: Context, config: Config) {
    config.chatConcurrentMaxSize = 1

    const plugin = new ChatHubPlugin<LmsysClientConfig, Config>(ctx, config, 'lmsys')

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return [
                {
                    apiKey: '',
                    platform: 'lmsys',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    formatMessages: config.formatMessages,
                    concurrentMaxSize: config.chatConcurrentMaxSize
                }
            ]
        })

        await plugin.registerClient((_, clientConfig) => new LMSYSClient(ctx, config, clientConfig))

        await plugin.initClients()
    })
}

export interface Config extends ChatHubPlugin.Config {
    formatMessages: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,

    Schema.object({
        formatMessages: Schema.boolean().description('是否使用历史聊天消息').default(false)
    }).description('对话设置')
])

export const using = ['chathub']

export const name = 'chathub-lmsys-adapter'
