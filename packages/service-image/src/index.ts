import { Context, Logger, Schema } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { Message } from 'koishi-plugin-chatluna'
import { modelSchema } from 'koishi-plugin-chatluna/utils/schema'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    addImageToContent,
    addTextToContent,
    parseGifToFrames,
    processImageWithModel,
    readImage
} from './utils'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-image-service')
    const plugin = new ChatLunaPlugin<ClientConfig, Config>(
        ctx,
        config,
        'image-service',
        false
    )

    ctx.on('ready', async () => {
        modelSchema(ctx)

        const [platform, modelName] = parseRawModelName(config.model)
        const imageUnderstandModel = await ctx.chatluna.createChatModel(
            platform,
            modelName
        )

        const disposable = ctx.chatluna.messageTransformer.intercept(
            'img',
            async (session, element, message, model) => {
                const parsedModelInfo =
                    model != null
                        ? ctx.chatluna.platform.findModel(model)
                        : undefined

                let imageData: Awaited<ReturnType<typeof readImage>>
                const url = (element.attrs.url ?? element.attrs.src) as string

                if (
                    parsedModelInfo?.value != null &&
                    parsedModelInfo.value.capabilities.includes(
                        ModelCapabilities.ImageInput
                    )
                ) {
                    imageData = await readImage(ctx, url)

                    if (imageData.ext == null) {
                        return false
                    }

                    if (imageData.ext === 'image/gif') {
                        logger.debug(`image url: ${url.substring(0, 50)}...`)
                        // Parse GIF and add multiple frames for models that support image input
                        const frames = await parseGifToFrames(
                            imageData.buffer,
                            {
                                strategy: config.gifStrategy,
                                frameCount: config.gifFrameCount
                            }
                        )

                        logger.debug(
                            `Extracted ${frames.length} frames from GIF`
                        )

                        for (const frame of frames) {
                            addImageToContent(message, frame)
                        }

                        return true
                    }
                }

                if (imageUnderstandModel.value == null) {
                    logger.warn(
                        `The model ${modelName} is not loaded, please check your chat adapter`
                    )
                    return false
                }

                if (
                    !imageUnderstandModel.value.modelInfo.capabilities.includes(
                        ModelCapabilities.ImageInput
                    )
                ) {
                    logger.warn(
                        `The model ${modelName} in image-service does not support image input, please check your chat adapter`
                    )
                    return false
                }

                try {
                    const fakeMessage: Message = {
                        content: []
                    }

                    logger.debug(`image url: ${url}`)

                    imageData = imageData ?? (await readImage(ctx, url))

                    if (imageData.ext == null) {
                        return false
                    }

                    // Parse GIF if needed
                    if (imageData.ext === 'image/gif') {
                        const frames = await parseGifToFrames(
                            imageData.buffer,
                            {
                                strategy: config.gifStrategy,
                                frameCount: config.gifFrameCount
                            }
                        )

                        logger.debug(
                            `Extracted ${frames.length} frames from GIF for model processing`
                        )

                        for (const frame of frames) {
                            addImageToContent(fakeMessage, frame)
                        }
                    } else {
                        addImageToContent(fakeMessage, imageData.base64Source)
                    }

                    const result = await processImageWithModel(
                        imageUnderstandModel.value,
                        config,
                        fakeMessage
                    )

                    if (result) {
                        addTextToContent(message, '\n\n' + result)
                    }
                } catch (error) {
                    logger.warn(
                        `Read image ${url} error, check your chat adapter`,
                        error
                    )
                }
            }
        )

        ctx.effect(() => disposable)
    })

    logger.debug(`${plugin.platformName} loaded`)
}

export interface Config extends ChatLunaPlugin.Config {
    model: string
    imagePrompt: string
    imageInsertPrompt: string
    gifStrategy: 'first' | 'head' | 'average'
    gifFrameCount: number
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        model: Schema.dynamic('model').default('无'),
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

export const name = 'chatluna-image-service'
