import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'


const logger = createLogger()


export function apply(ctx: Context, config: Config) {

}


export interface Config extends ChatHubPlugin.Config {
    pbcookie: string,
    formatMessages: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,

    Schema.object({
        pbcookie: Schema.string().role('secret').description('已登录的 Poe 账号 的 Cookie 的 p-b 的值').default("").required()
    }).description('请求设置'),

    Schema.object({
        formatMessages: Schema.boolean().description('是否使用历史聊天消息').default(true),
    }).description('对话设置'),

])



export const using = ['chathub']

export const name = "@dingyi222666/chathub-poe-adapter"