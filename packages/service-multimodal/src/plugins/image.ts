/* eslint-disable max-len */
import { Context } from 'koishi'
import { Message } from 'koishi-plugin-chatluna'
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

export async function apply(
    ctx: Context,
    config: Config,
    _plugin: ChatLunaPlugin
) {
    const imageUnderstandModel = await ctx.chatluna.createChatModel(
        config.imageModel
    )

    const disposable = ctx.chatluna.messageTransformer.intercept(
        'img',
        async (_session, element, message, model) => {
            const parsedModelInfo =
                model != null
                    ? ctx.chatluna.platform.findModel(model)
                    : undefined
            const modelSupportsImageInput =
                parsedModelInfo?.value != null &&
                parsedModelInfo.value.capabilities.includes(
                    ModelCapabilities.ImageInput
                )

            let imageData: Awaited<ReturnType<typeof readImage>>
            const url = (element.attrs.url ?? element.attrs.src) as string

            if (modelSupportsImageInput) {
                imageData = await readImage(ctx, url)

                if (imageData.ext == null) {
                    return false
                }

                if (imageData.ext === 'image/gif') {
                    if (!config.enableContextGifHandling) {
                        return false
                    }

                    logger.debug(`image url: ${url.substring(0, 50)}...`)
                    const frames = await parseGifToFrames(imageData.buffer, {
                        strategy: config.gifStrategy,
                        frameCount: config.gifFrameCount
                    })

                    logger.debug(`Extracted ${frames.length} frames from GIF`)

                    for (const frame of frames) {
                        addImageToContent(message, frame)
                    }

                    addTextToContent(message, '[image: GIF]')

                    return true
                }

                if (imageData.base64Source != null) {
                    addImageToContent(message, imageData.base64Source)
                    return true
                }
            }

            if (!config.enableContextImageDescription) {
                return false
            }

            if (imageUnderstandModel.value == null) {
                logger.warn(
                    `The model ${config.imageModel} is not loaded, please check your chat adapter`
                )
                return false
            }

            if (
                !imageUnderstandModel.value.modelInfo.capabilities.includes(
                    ModelCapabilities.ImageInput
                )
            ) {
                logger.warn(
                    `The model ${config.imageModel} in image-service does not support image input, please check your chat adapter`
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

                if (imageData.ext === 'image/gif') {
                    if (!config.enableContextGifHandling) {
                        return false
                    }

                    const frames = await parseGifToFrames(imageData.buffer, {
                        strategy: config.gifStrategy,
                        frameCount: config.gifFrameCount
                    })

                    logger.debug(
                        `Extracted ${frames.length} frames from GIF for model processing`
                    )

                    addTextToContent(
                        fakeMessage,
                        'This is a GIF image. See the frames below:'
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
                    return true
                }
            } catch (error) {
                logger.warn(
                    `Read image ${url} error, check your chat adapter`,
                    error
                )
            }
        },
        100
    )

    ctx.effect(() => disposable)
}
