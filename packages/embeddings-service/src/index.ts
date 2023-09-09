import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'

import { Context, Schema } from 'koishi'
import { embeddings } from './embeddings'

const logger = createLogger()

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatHubPlugin(ctx, config, 'embeddings', false)

    ctx.on('ready', async () => {
        await plugin.registerToService()

        await embeddings(ctx, config, plugin)
    })
}

export interface Config extends ChatHubPlugin.Config {
    huggingface: boolean
    huggingfaceApiKeys: string[]
    huggingfaceModels: string[]
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        huggingface: Schema.boolean().description('是否启用 Huggingface 提供的 Embeddings 服务').default(false)
    }).description('Embeddings 设置'),

    Schema.union([
        Schema.object({
            huggingface: Schema.const(true).required(),
            huggingfaceApiKeys: Schema.array(Schema.string().role('secret')).description('访问 Huggingface 的 API Key').required(),
            huggingfaceModels: Schema.array(String).description('调用 Huggingface 的 Embeddings 模型').default(['sentence-transformers/distilbert-base-nli-mean-tokens'])
        }).description('Huggingface 设置'),
        Schema.object({})
    ])
]) as Schema<Config>

export const using = ['chathub']

export const name = '@dingyi222666/chathub-embeddings-service'
