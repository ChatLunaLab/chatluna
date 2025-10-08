import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

import { Context, Schema } from 'koishi'

import { vectorStore } from './vectorstore'
import { ChatLunaRAGService } from './service/rag'
import { registerAllPrompts } from './rag/hipporag/prompt/PromptManager'

export * from './rag'
export * from './service/rag'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(
        ctx,
        config,
        'vector-store-service',
        false
    )

    ctx.plugin(ChatLunaRAGService, config)

    ctx.on('ready', async () => {
        await registerAllPrompts()
        await vectorStore(ctx, config, plugin)
    })
}

export interface Config extends ChatLunaPlugin.Config {
    vectorStore: string[]
    redisUrl: string

    milvusUrl: string
    milvusUsername: string
    milvusPassword: string
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        vectorStore: Schema.array(
            Schema.union([
                Schema.const('faiss').description('Faiss'),
                Schema.const('redis').description('Redis'),
                Schema.const('milvus').description('Milvus'),
                Schema.const('luna-vdb').description('lunavdb')
            ])
        )
            .default(['luna-vdb'])
            .role('select')
    }),

    Schema.object({
        redisUrl: Schema.string().role('url').default('redis://127.0.0.1:6379')
    }),

    Schema.object({
        milvusUrl: Schema.string()
            .role('url')
            .default('http://127.0.0.1:19530'),
        milvusUsername: Schema.string().default(''),
        milvusPassword: Schema.string().role('secret').default('')
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const usage = `
现我们不再直接依赖向量数据库的相关库，你需要自己安装相关依赖到 koishi 根目录下。

要查看如何配置 Faiss 数据库，看[这里](https://chatluna.chat/guide/configure-vector-database/faiss.html)
要查看如何配置 Redis 数据库，看[这里](https://chatluna.chat/guide/configure-vector-database/redis.html)
要查看如何配置 Milvus 数据库，看[这里](https://chatluna.chat/guide/configure-vector-database/milvus.html)

目前配置 Faiss 数据库安装后可能会导致 koishi 环境不安全。当安装完成后进行某些操作，导致你的 Koishi 环境出现了问题（如升级 node 版本），开发者不对此负直接责任。
`

export const name = 'chatluna-vector-store-service'
