import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'
import { BardProvider } from './provider'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'


const logger = createLogger('@dingyi222666/chathub-bard-adapter')

class BardPlugin extends ChatHubPlugin<BardPlugin.Config> {

    name = "@dingyi222666/chathub-bard-adapter"

    constructor(protected ctx: Context, public readonly config: BardPlugin.Config) {
        super(ctx, config)
        this.config.chatConcurrentMaxSize = 0

        setTimeout(async () => {
            await ctx.chathub.registerPlugin(this)

            this.registerModelProvider(new BardProvider(config))
        })

    }
}


namespace BardPlugin {

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends ChatHubPlugin.Config {
        cookie: string
    }

    export const Config: Schema<Config> = Schema.intersect([
        ChatHubPlugin.Config,

        Schema.object({
            cookie: Schema.string().role('secret').description('在 bard.google.com 登录后获取的Cookie').required()
        }).description('请求设置'),
    ])



    export const using = ['chathub']

}



export default BardPlugin