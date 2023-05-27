import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"

import { Context, Schema } from 'koishi'

const logger = createLogger('@dingyi222666/chathub-embeddings-service')

class EmbeddingsPlugin extends ChatHubPlugin<EmbeddingsPlugin.Config> {

    name = "@dingyi222666/chathub-openai-adapter"

    constructor(protected ctx: Context, public readonly config: EmbeddingsPlugin.Config) {
        super(ctx, config)

        setTimeout(async () => {

            await ctx.chathub.registerPlugin(this)
        })

    }
}

namespace EmbeddingsPlugin {

    export interface Config extends ChatHubPlugin.Config {
        searchEngine: string
        topK: number
    }

    export const Config: Schema<Config> = Schema.intersect([
        Schema.object({
            searchEngine: Schema.union([
                Schema.const("baidu").description("百度"),
                Schema.const("bing-web").description("必应（网页版）"),
                Schema.const("duckduckgo-lite").description("DuckDuckGo(Lite)"),
            ]
            ).default("bing-web").description('搜索引擎'),
            topK: Schema.number().description('参考结果数量（2~10）')
                .min(2).max(10).step(1).default(2),

        }).description('搜索设置')
    ]) as Schema<Config>

    export const using = ['chathub']

}



export default EmbeddingsPlugin