import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'

import fs from 'fs/promises'
import path from 'path'
import os from 'os'


const logger = createLogger('@dingyi222666/chathub-bard-adapter')


export function apply(ctx: Context, config: Config) {
    config.chatConcurrentMaxSize = 1
}


//export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

export interface Config extends ChatHubPlugin.Config {
    cookie: string
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,

    Schema.object({
        cookie: Schema.string().role('secret').description('在 bard.google.com 登录后获取的 Cookie').required()
    }).description('请求设置'),
])



export const using = ['chathub']

export const name = "chathub-bard-adapter"