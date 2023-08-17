import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'

import { GPTFreeModelProvider } from './providers'

const logger = createLogger('@dingyi222666/chathub-gptfree-adapter')

class GPTFreePlugin extends ChatHubPlugin<GPTFreePlugin.Config> {

    name = "@dingyi222666/chathub-gptfree-adapter"

    constructor(protected ctx: Context, public readonly config: GPTFreePlugin.Config) {
        super(ctx, config)


        setTimeout(async () => {
            await ctx.chathub.registerPlugin(this)

            this.registerModelProvider(new GPTFreeModelProvider(config))

        })

    }
}


namespace GPTFreePlugin {

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends ChatHubPlugin.Config {
        apiEndPoint: string
    }

    export const Config: Schema<Config> = Schema.intersect([
        ChatHubPlugin.Config,
        Schema.object({
            apiEndPoint: Schema.string().description('请求 GPTFree 自搭建后端的API地址').required(),

        }).description('请求设置'),
    ])

    export const using = ['chathub']

}



export default GPTFreePlugin