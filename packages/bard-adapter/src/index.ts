import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { Context, Schema } from 'koishi'

import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { BardClient } from './client'

const logger = createLogger()

export function apply(ctx: Context, config: Config) {
    config.chatConcurrentMaxSize = 1

    const plugin = new ChatHubPlugin(ctx, config, 'bard')

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.cookies.map((apiKey) => {
                return {
                    apiKey,
                    platform: 'bard',
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    concurrentMaxSize: config.chatConcurrentMaxSize
                }
            })
        })

        await plugin.registerClient((_, clientConfig) => new BardClient(ctx, config, clientConfig))

        await plugin.initClients()
    })
}

// export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

export interface Config extends ChatHubPlugin.Config {
    cookies: string[]
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,

    Schema.object({
        cookies: Schema.array(Schema.string().role('secret').required()).description('在 bard.google.com 登录后获取的 Cookie')
    }).description('请求设置')
])

export const using = ['chathub']

export const name = 'chathub-bard-adapter'
