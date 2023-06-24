import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"

import { Context, Schema } from 'koishi'
import { vectorstore } from './vectorstore'

const logger = createLogger('@dingyi222666/chathub-vectorstrore-service')

class VectorStrorePlugin extends ChatHubPlugin<VectorStrorePlugin.Config> {

    name = "@dingyi222666/chathub-vector-strore-service"

    constructor(protected ctx: Context, public readonly config: VectorStrorePlugin.Config) {
        super(ctx, config)

        setTimeout(async () => {

            await ctx.chathub.registerPlugin(this)

            await vectorstore(ctx, config, this)
        })


    }
}

namespace VectorStrorePlugin {

    export interface Config extends ChatHubPlugin.Config {
        topK: number,
        current: string,
        faissSavePath: string,

        pinecone: boolean,
        pineconeKey: string,
        pineconeRegon: string,
        pineconeIndex: string,
    }

    export const Config: Schema<Config> = Schema.intersect([
        Schema.object({
            topK: Schema.number().description('向量数据库的匹配数量').default(3).min(1).max(7),

            current: Schema.union([
                Schema.const("faiss").description("Faiss 本地向量数据库"),
                Schema.const("pinecone").description("Pinecone 云向量数据库"),
            ]).default("faiss").description('当前使用的向量数据库'),
        }).description('向量数据库设置'),

        Schema.union([
            Schema.object({
                current: Schema.const("faiss").required(),
                faissSavePath: Schema.string().description('faiss 向量数据库保存路径').default("data/chathub/vectorstrore/faiss"),
            }).description("Faiss 设置"),
            Schema.object({
                current: Schema.const("pinecone").required(),
                pineconeKey: Schema.string().role("secret").description('Pinecone 的 API Key').required(),
                pineconeRegon: Schema.string().description('Pinecone 的地区').required(),
                pineconeIndex: Schema.string().description('Pinecone 的索引名称').required(),
            }),
            Schema.object({}),
        ]),


    ]) as Schema<Config>

    export const using = ['chathub']

}



export default VectorStrorePlugin