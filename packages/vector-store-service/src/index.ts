import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { ChatHubService } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'

import { Context, Schema } from 'koishi'
import { vector_store } from './vectorstore'

const logger = createLogger()

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatHubPlugin(ctx, config, "vector-store-service", false)

    ctx.on("ready", async () => {
        await plugin.registerToService()
        
        await vector_store(ctx, config, plugin)
    })
}


export interface Config extends ChatHubPlugin.Config {
    topK: number,

    pinecone: boolean,
    pineconeKey: string,
    pineconeRegon: string,
    pineconeIndex: string,

    vectorSize: number,
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        topK: Schema.number().description('向量数据库的匹配数量').default(3).min(1).max(7),
        vectorSize: Schema.number().description('向量的维度').default(1536).min(1).max(8192),
    }).description('向量数据库设置'),


    Schema.object({
        pineconeKey: Schema.string().role("secret").description('Pinecone API Key'),
        pineconeRegon: Schema.string().description('Pinecone 地区'),
        pineconeIndex: Schema.string().description('Pinecone 索引名称')
    }).description('Pinecone 数据库设置'),


]) as Schema<Config>

export const using = ['chathub']

export const usage =
    `
在新版本中我们不再直接依赖向量数据库的相关库，你需要自己安装相关依赖到 koishi 根目录下。

要查看如何配置 Faiss 数据库，看[这里](https://js.langchain.com/docs/modules/indexes/vector_stores/integrations/faiss#setup)

要查看如何配置 Pinecone 数据库，看[这里](https://js.langchain.com/docs/modules/indexes/vector_stores/integrations/pinecone#setup)

要查看如何配置 LanceDB 数据库，看[这里](https://js.langchain.com/docs/modules/data_connection/vectorstores/integrations/lancedb#setup)

目前配置 Faiss 或 LanceDB 数据库安装后可能会导致 koishi 环境不安全，如果安装完成后进行某些操作完成后出现了问题（如，升级 node 版本），开发者不对此负直接责任。
`

export const name = "chathub-vector-store-service"


