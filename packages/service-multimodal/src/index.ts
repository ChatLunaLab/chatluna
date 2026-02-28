import { Context, Logger, Schema } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { modelSchema } from 'koishi-plugin-chatluna/utils/schema'
import { plugins } from './plugin'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-multimodal-service')
    const plugin = new ChatLunaPlugin<ClientConfig, Config>(
        ctx,
        config,
        'multimodal-service',
        false
    )

    ctx.on('ready', async () => {
        modelSchema(ctx)
        await plugins(ctx, config, plugin)
    })
}

export interface Config extends ChatLunaPlugin.Config {
    imageModel: string
    enableMultimodalTool: boolean
    enableAudioFfmpegConversion: boolean
    fileInsertPrompt: string
    imagePrompt: string
    imageInsertPrompt: string
    gifStrategy: 'first' | 'head' | 'average'
    gifFrameCount: number
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        enableMultimodalTool: Schema.boolean().default(false)
    }),
    Schema.object({
        enableAudioFfmpegConversion: Schema.boolean().default(false)
    }),
    Schema.object({
        fileInsertPrompt: Schema.string()
            .role('textarea')
            .default(
                `以下是通过工具读取的文件内容，请结合这些内容回答用户的问题。`
            )
    }),
    Schema.object({
        imageModel: Schema.dynamic('model').default('无'),
        imagePrompt: Schema.string()
            .role('textarea')
            .default(
                `你现在是一个图片描述大师。你需要根据下面提供的图片，对该图片或者图片列表生成 150-400 字的中文描述。包括图片的主要内容和场景，里面可能包含的梗，人物等。`
            ),
        imageInsertPrompt: Schema.string()
            .role('textarea')
            .default(
                `<img>这是一张图片的描述: {img}。如果用户需要询问一些关于图片的问题，请根据上面的描述回答。如果用户没有提供图片，请忽略上面的描述。</img>`
            ),
        gifStrategy: Schema.union([
            Schema.const('first'),
            Schema.const('head'),
            Schema.const('average')
        ]).default('first'),
        gifFrameCount: Schema.number().min(1).max(5).default(3)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-multimodal-service'
