import { ChatLunaPlugin } from 'koishi-plugin-chatluna/lib/services/chat'

import { Context, Schema } from 'koishi'
import { vectorStore } from './vectorstore'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(
        ctx,
        config,
        'vector-store-service',
        false
    )

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await vectorStore(ctx, config, plugin)
    })
}

export interface Config extends ChatLunaPlugin.Config {
    topK: number

    redisUrl: string

    vectorSize: number
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        topK: Schema.number()
            .description('向量数据库的匹配数量')
            .default(3)
            .min(1)
            .max(7),
        vectorSize: Schema.number()
            .description('向量的维度')
            .default(1536)
            .min(1)
            .max(8192)
    }).description('向量数据库设置'),

    Schema.object({
        redisUrl: Schema.string().role('url').description('Redis url 地址')
    }).description('redis 数据库设置')
]) as Schema<Config>

export const inject = ['chatluna']

export const usage = `
现我们不再直接依赖向量数据库的相关库，你需要自己安装相关依赖到 koishi 根目录下。

要查看如何配置 Faiss 数据库，看[这里](https://js.langchain.com/docs/modules/indexes/vector_stores/integrations/faiss#setup)

要查看如何配置 Redis 数据库，看[这里](https://js.langchain.com/docs/modules/indexes/vector_stores/integrations/redis#setup)

要查看如何配置 LanceDB 数据库，看[这里](https://js.langchain.com/docs/modules/data_connection/vectorstores/integrations/lancedb#setup)

目前配置 Faiss 或 LanceDB 数据库安装后可能会导致 koishi 环境不安全，如果安装完成后进行某些操作完成后出现了问题（如，升级 node 版本），开发者不对此负直接责任。
`

export const name = 'chatluna-vector-store-service'
