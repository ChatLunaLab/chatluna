import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'
import { PoeProvider } from './provider'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'


const logger = createLogger('@dingyi222666/chathub-poe-adapter')

class PoePlugin extends ChatHubPlugin<PoePlugin.Config> {

    name = "@dingyi222666/chathub-poe-adapter"

    constructor(protected ctx: Context, public readonly config: PoePlugin.Config) {
        super(ctx, config)
        this.config.chatConcurrentMaxSize = 0

        setTimeout(async () => {
            await ctx.chathub.registerPlugin(this)

            this.registerModelProvider(new PoeProvider(config))
        })

    }
}


namespace PoePlugin {

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends ChatHubPlugin.Config {
        pbcookie: string,
        formatMessages: boolean
    }

    export const Config: Schema<Config> = Schema.intersect([
        ChatHubPlugin.Config,

        Schema.object({
            pbcookie: Schema.string().description('已登录的 Poe 账号 的cookie的 p-b 的值').default("").required()
        }).description('请求设置'),

        Schema.object({
            formatMessages: Schema.boolean().description('是否尝试使用历史聊天消息').default(false),
        }).description('对话设置'),

    ])



    export const using = ['chathub']

}



export default PoePlugin