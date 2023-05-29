import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"

import { Context, Schema } from 'koishi'
import { embeddings } from './embeddings'

const logger = createLogger('@dingyi222666/chathub-embeddings-service')

class EmbeddingsPlugin extends ChatHubPlugin<EmbeddingsPlugin.Config> {

    name = "@dingyi222666/chathub-embeddings-service"

    constructor(protected ctx: Context, public readonly config: EmbeddingsPlugin.Config) {
        super(ctx, config)

        setTimeout(async () => {

            await ctx.chathub.registerPlugin(this)

            await embeddings(ctx, config, this)
        })


    }
}

namespace EmbeddingsPlugin {

    export interface Config extends ChatHubPlugin.Config {
        huggingface: boolean,
        huggingfaceApiKey?: string,
        huggingfaceEmbeddingModel: string,
    }

    export const Config: Schema<Config> = Schema.intersect([
        Schema.object({
            huggingface: Schema.boolean().description('是否启用huggingface的 Embeddings 服务').default(false),
        }).description('Embeddings 设置'),

        Schema.union([
            Schema.object({
                huggingface: Schema.const(true).required(),
                huggingfaceApiKey: Schema.string().description('访问 huggingface 的 API Key').required(),
                huggingfaceEmbeddingModel: Schema.string().description('调用 huggingface 的 Embeddings 模型').default("sentence-transformers/distilbert-base-nli-mean-tokens"),
            }).description("huggingface 设置"),
            Schema.object({}),
        ]),


    ]) as Schema<Config>

    export const using = ['chathub']

}



export default EmbeddingsPlugin