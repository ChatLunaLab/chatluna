import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Schema } from 'koishi'
import { embeddings } from './embeddings'

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, 'embeddings', false)

    ctx.on('ready', async () => {
        plugin.registerToService()
        await embeddings(ctx, config, plugin)
    })
}

export interface Config extends ChatLunaPlugin.Config {
    huggingface: boolean
    huggingfaceApiKeys: string[]
    huggingfaceModels: string[]
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        huggingface: Schema.boolean().default(false)
    }),
    Schema.union([
        Schema.object({
            huggingface: Schema.const(true).required(),
            huggingfaceApiKeys: Schema.array(
                Schema.string().role('secret')
            ).required(),
            huggingfaceModels: Schema.array(String).default([
                'sentence-transformers/distilbert-base-nli-mean-tokens'
            ])
        }),
        Schema.object({})
    ])
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

export const inject = ['chatluna']

export const name = '@dingyi222666/chathub-embeddings-service'
