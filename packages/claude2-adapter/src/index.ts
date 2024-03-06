import { ChatLunaPlugin } from 'koishi-plugin-chatluna/src/services/chat'
import { Context, Schema } from 'koishi'
import { Claude2Client } from './client'
import { Claude2ClientConfig } from './types'

export function apply(ctx: Context, config: Config) {
    config.chatConcurrentMaxSize = 1

    const plugin = new ChatLunaPlugin<Claude2ClientConfig, Config>(
        ctx,
        config,
        'claude2'
    )

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.cookies.map((apiKey) => {
                return {
                    apiKey,
                    platform: 'claude2',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize,
                    formatMessages: config.formatMessages
                }
            })
        })

        await plugin.registerClient(
            (_, clientConfig) => new Claude2Client(ctx, config, clientConfig)
        )

        await plugin.initClients()
    })
}

// export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

export interface Config extends ChatLunaPlugin.Config {
    cookies: string[]
    userAgent: string
    JA3Fingerprint: string
    formatMessages: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,

    Schema.object({
        cookies: Schema.array(
            Schema.string().role('secret').required()
        ).description('Claude 账号的 Cookie'),
        userAgent: Schema.string()
            .description('访问 Claude 的 User Agent 头')
            .default(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 Edg/118.0.2088.46'
            ),
        JA3Fingerprint: Schema.string().description('JA3 指纹').default(
            // eslint-disable-next-line max-len
            '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,65281-43-27-51-11-35-17513-18-23-45-16-0-10-13-5-21,29-23-24,0'
        )
    }).description('请求设置'),

    Schema.object({
        formatMessages: Schema.boolean()
            .description('是否使用历史聊天消息')
            .default(false)
    }).description('对话设置')
])

export const inject = ['chatluna']

export const name = 'chatluna-claude2-adapter'
