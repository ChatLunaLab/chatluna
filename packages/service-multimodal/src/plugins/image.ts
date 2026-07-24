import { Context } from 'koishi'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config, logger } from '..'
import {
    addImageToContent,
    addTextToContent,
    buildDescribeMessage,
    getOrDescribeImage,
    parseGifToFrames,
    processImageWithModel,
    readImage,
    singleFlight
} from '../utils'

type ImageData = Awaited<ReturnType<typeof readImage>>
const imageLoads = new Map<string, Promise<ImageData>>()

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

                const scope = message.conversationId
                const imageData = await singleFlight(
                    imageLoads,
                    scope == null ? undefined : `${scope}\0${url}`,
                    () => readImage(ctx, url)
                )
                if (imageData.buffer == null || imageData.ext == null) {
                    return false
                }

                const mime = imageData.ext
                if (mime === 'image/gif' && !config.enableContextGifHandling) {
                    return false
                }

                if (native) {
                    if (mime === 'image/gif') {
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
                        addTextToContent(message, '[image: GIF]')
                    }
                    return false
                }

                try {
                    const text = await getOrDescribeImage(
                        scope,
                        imageData.buffer,
                        config,
                        async () => {
                            const imageModel = imageUnderstandModel.value
                            if (
                                imageModel == null ||
                                !imageModel.modelInfo.capabilities.includes(
                                    ModelCapabilities.ImageInput
                                )
                            ) {
                                logger.warn(
                                    `Image-description model "${config.imageModel}" is missing or lacks image input — skip.`
                                )
                                return null
                            }
                            return processImageWithModel(
                                imageModel,
                                config,
                                await buildDescribeMessage(
                                    imageData.buffer,
                                    mime,
                                    config
                                )
                            )
                        }
                    )
                    if (text != null) addTextToContent(message, '\n\n' + text)
                } catch (error) {
                    logger.warn(`Image describe failed:`, error)
                }
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
