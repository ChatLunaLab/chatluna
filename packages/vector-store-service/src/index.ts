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
        faiss: boolean,
        faissSavePath: string,

    }

    export const Config: Schema<Config> = Schema.intersect([
        Schema.object({
            topK: Schema.number().description('向量数据库的匹配数量').default(3).min(1).max(7),
            faiss: Schema.boolean().description('是否启用 faiss 向量数据库').default(false),
        }).description('向量数据库设置'),

        Schema.union([
            Schema.object({
                faiss: Schema.const(true).required(),
                faissSavePath: Schema.string().description('faiss 向量数据库保存路径').default("data/chathub/vectorstrore/faiss"),
            }).description("faiss 设置"),
            Schema.object({}),
        ]),


    ]) as Schema<Config>

    export const using = ['chathub']

}



export default VectorStrorePlugin