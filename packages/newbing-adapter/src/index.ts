import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'


const logger = createLogger('@dingyi222666/chathub-poe-adapter')

class BingChatPlugin extends ChatHubPlugin<BingChatPlugin.Config> {

    name = "@dingyi222666/chathub-newbing-adapter"

    constructor(protected ctx: Context, public readonly config: BingChatPlugin.Config) {
        super(ctx, config)
        
        this.config.chatConcurrentMaxSize = 0

        setTimeout(async () => {
            await ctx.chathub.registerPlugin(this)

            // this.registerModelProvider(new PoeProvider(config))
        })

    }
}


namespace BingChatPlugin {

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends ChatHubPlugin.Config {
        cookie: string,
        showExtraInfo: boolean,
        showLinkInfo: boolean
        sydney: boolean
    }

    export const Config: Schema<Config> = Schema.intersect([
        ChatHubPlugin.Config,

        Schema.object({
            cookie: Schema.string().description('Bing 账号的 cookie').default("").required()
        }).description('请求设置'),


        Schema.object({
            sydney: Schema.boolean().description('是否开启 Sydeny 模式（破解对话20次回复数限制，账号可能会有风险）').default(false),

            showExtraInfo: Schema.boolean().description('是否显示额外信息（如剩余回复数，猜你想问）').default(false),
            showLinkInfo: Schema.boolean().description('是否显示 Bing 引用的链接信息').default(false),
        }).description('对话设置'),


    ])



    export const using = ['chathub']

}



export default BingChatPlugin