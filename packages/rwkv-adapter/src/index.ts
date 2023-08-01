import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'

import { RWKVEmbeddingsProvider, RWKVModelProvider } from './providers'

const logger = createLogger('@dingyi222666/chathub-rwkv-adapter')

class RWKVPlugin extends ChatHubPlugin<RWKVPlugin.Config> {

    name = "@dingyi222666/chathub-rwkv-adapter"

    constructor(protected ctx: Context, public readonly config: RWKVPlugin.Config) {
        super(ctx, config)


        setTimeout(async () => {
            await ctx.chathub.registerPlugin(this)

            this.registerModelProvider(new RWKVModelProvider(config))
            this.registerEmbeddingsProvider(new RWKVEmbeddingsProvider(config))
        })

    }
}


namespace RWKVPlugin {

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends ChatHubPlugin.Config {
        apiKey: string
        apiEndPoint: string
        maxTokens: number
        chatModel: string
    }

    export const Config: Schema<Config> = Schema.intersect([
        ChatHubPlugin.Config,
        Schema.object({
            apiEndPoint: Schema.string().description('RWKV Runner 后端 API 地址').required(),
            apiKey: Schema.string().role('secret').description('RWKV 自搭建后端的身份验证 API Key').default("sk-"),


        }).description('请求设置'),

        Schema.object({
            maxTokens: Schema.number().description('回复的最大Token数（16~8192，必须是16的倍数）')
                .min(16).max(8192).step(16).default(256),
            chatModel: Schema.string().description('在 RWKV Runner 里设置的聊天模型名称').default('gpt-3.5-turbo')
        }).description('模型设置'),


    ])

    export const using = ['chathub']

}



export default RWKVPlugin