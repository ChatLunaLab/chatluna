import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { PoeClientConfig } from './types'
import { PoeClient } from './client'


const logger = createLogger()


export function apply(ctx: Context, config: Config) {
    config.chatConcurrentMaxSize = 1
    const plugin = new ChatHubPlugin<PoeClientConfig, Config>(ctx, config, "poe")

    ctx.on("ready", async () => {
        await plugin.registerToService()

        await plugin.parseConfig((config) => {
            return config.cookies.map((cookie) => {
                return {
                    apiKey: cookie,
                    platform: "poe",
                    chatLimit: config.chatTimeLimit,
                    timeout: config.timeout,
                    maxRetries: config.maxRetries,
                    formatMessages: config.formatMessages,
                    concurrentMaxSize: config.chatConcurrentMaxSize,
                }
            })
        })

        await plugin.registerClient((_, clientConfig) => new PoeClient(ctx, config, clientConfig))

        await plugin.initClients()
    })
}


export interface Config extends ChatHubPlugin.Config {
    cookies: string[],
    formatMessages: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,

    Schema.object({
        cookies: Schema.array(
            Schema.string().role('secret').required()
        ).description('已登录的 Poe 账号 Cookie 的 p-b 的值'),
    }).description('请求设置'),

    Schema.object({
        formatMessages: Schema.boolean().description('是否使用历史聊天消息').default(true),
    }).description('对话设置'),

])



export const using = ['chathub']

export const name = "@dingyi222666/chathub-poe-adapter"