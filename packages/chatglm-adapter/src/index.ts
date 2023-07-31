import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'

import { ChatGLMEmbeddingsProvider, ChatGLMModelProvider } from './providers'

const logger = createLogger('@dingyi222666/chathub-chatglm-adapter')

class ChatGLMPlugin extends ChatHubPlugin<ChatGLMPlugin.Config> {

    name = "@dingyi222666/chathub-chatglm-adapter"

    constructor(protected ctx: Context, public readonly config: ChatGLMPlugin.Config) {
        super(ctx, config)


        setTimeout(async () => {
            await ctx.chathub.registerPlugin(this)

            this.registerModelProvider(new ChatGLMModelProvider(config))
            this.registerEmbeddingsProvider(new ChatGLMEmbeddingsProvider(config))
        })

    }
}


namespace ChatGLMPlugin {

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends ChatHubPlugin.Config {
        apiKey: string
        apiEndPoint: string
        maxTokens: number
        temperature: number
    }

    export const Config: Schema<Config> = Schema.intersect([
        ChatHubPlugin.Config,
        Schema.object({
            apiEndPoint: Schema.string().description('请求 ChatGLM 自搭建后端的API地址').required(),
            apiKey: Schema.string().role('secret').description('ChatGLM 自搭建后端的身份验证 api key').required(),


        }).description('请求设置'),

        Schema.object({
            maxTokens: Schema.number().description('回复的最大 Token 数（16~512，必须是16的倍数）')
                .min(16).max(512).step(16).default(256),
            temperature: Schema.percent().description('回复温度，越高越随机')
                .min(0).max(1).step(0.1).default(0.8),

        }).description('模型设置'),


    ])

    export const using = ['chathub']

}



export default ChatGLMPlugin