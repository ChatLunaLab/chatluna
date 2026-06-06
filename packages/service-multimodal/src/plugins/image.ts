import { Context } from 'koishi'
import { Message } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config, logger } from '..'
import {
    addImageToContent,
    addTextToContent,
    parseGifToFrames,
    processImageWithModel,
    readImage
} from '../utils'

/**
 * Intercept image elements. Native-capable models receive the data URL
 * directly (GIFs are split into frames). Otherwise fall back to describing
 * the image via the configured vision model and inject the description.
 */
export async function apply(
    ctx: Context,
    config: Config,
    _plugin: ChatLunaPlugin
) {
    const imageUnderstandModel = await ctx.chatluna.createChatModel(
        config.imageModel
    )

    ctx.effect(() =>
        ctx.chatluna.messageTransformer.intercept(
            'img',
            async (_session, element, message, model) => {
                const url = (element.attrs.url ?? element.attrs.src) as string
                if (!url) return false

                const native = modelAcceptsImage(ctx, model)
                if (!native && !config.enableContextImageDescription) {
                    return false
                }

                const imageData = await readImage(ctx, url)
                if (imageData.ext == null) return false

                const isGif = imageData.ext === 'image/gif'
                if (isGif && !config.enableContextGifHandling) return false

                if (native) {
                    if (isGif) {
                        await injectGifFrames(message, imageData.buffer, config)
                        addTextToContent(message, '[image: GIF]')
                    }
                    return false
                }

                await describeAndInject(
                    message,
                    imageData,
                    isGif,
                    config,
                    imageUnderstandModel.value,
                    url
                )
                return false
            },
            100
        )
    )
}

function modelAcceptsImage(ctx: Context, model: string | undefined): boolean {
    if (!model) return false
    return (
        ctx.chatluna.platform
            .findModel(model)
            ?.value?.capabilities?.includes(ModelCapabilities.ImageInput) ===
        true
    )
}

async function injectGifFrames(
    message: Message,
    buffer: Buffer,
    config: Config
): Promise<void> {
    const frames = await parseGifToFrames(buffer, {
        strategy: config.gifStrategy,
        frameCount: config.gifFrameCount
    })
    logger.debug(`Extracted ${frames.length} frames from GIF`)
    for (const frame of frames) addImageToContent(message, frame)
}

async function describeAndInject(
    message: Message,
    imageData: Awaited<ReturnType<typeof readImage>>,
    isGif: boolean,
    config: Config,
    imageModel: ChatLunaChatModel | undefined,
    url: string
): Promise<boolean> {
    if (
        imageModel == null ||
        !imageModel.modelInfo.capabilities.includes(
            ModelCapabilities.ImageInput
        )
    ) {
        logger.warn(
            `Image-description model "${config.imageModel}" is missing or lacks image input — skip.`
        )
        return false
    }

    try {
        const fake: Message = { content: [] }
        if (isGif) {
            addTextToContent(fake, 'This is a GIF image. See the frames below:')
            await injectGifFrames(fake, imageData.buffer, config)
        } else if (imageData.base64Source) {
            addImageToContent(fake, imageData.base64Source)
        }
        const result = await processImageWithModel(imageModel, config, fake)
        if (result) {
            addTextToContent(message, '\n\n' + result)
            return true
        }
    } catch (error) {
        logger.warn(`Image describe failed for ${url}:`, error)
    }
    return false
}
