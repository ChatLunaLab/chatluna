/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { Context } from 'koishi'
import { ComputedRef, Message } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ChatLunaToolRunnable,
    ModelCapabilities
} from 'koishi-plugin-chatluna/llm-core/platform/types'
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
    plugin: ChatLunaPlugin
) {
    const imageUnderstandModel = await ctx.chatluna.createChatModel(
        config.imageModel
    )

    if (config.enableMultimodaTool) {
        plugin.registerTool('read_image', {
            selector() {
                return true
            },
            createTool() {
                return new ReadImageTool(
                    ctx,
                    config,
                    () => imageUnderstandModel
                )
            }
        })
    }

    const disposable = ctx.chatluna.messageTransformer.intercept(
        'img',
        async (_session, element, message, model) => {
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

export class ReadImageTool extends Tool {
    name = 'read_image'

    description =
        'Describe an image from a URL or data URI. Input should be the image URL.'

    constructor(
        private readonly ctx: Context,
        private readonly config: Config,
        private readonly imageModelRef: () => ComputedRef<
            ChatLunaChatModel | undefined
        >
    ) {
        super({})
    }

    /** @ignore */
    async _call(input: string, _, _runConfig: ChatLunaToolRunnable) {
        const url = input?.trim()
        if (!url) {
            return 'No image url provided.'
        }

        const model = this.imageModelRef().value
        if (model == null) {
            logger.warn(
                'Image model is not loaded, please check your chat adapter.'
            )
            return 'Image model is not loaded. Please check your chat adapter.'
        }

        if (
            !model.modelInfo.capabilities.includes(ModelCapabilities.ImageInput)
        ) {
            logger.warn('Image model does not support image input.')
            return 'Image model does not support image input.'
        }

        try {
            const imageData = await readImage(this.ctx, url)

            if (
                imageData.ext == null ||
                imageData.buffer == null ||
                imageData.base64Source == null
            ) {
                return `Failed to read image from ${url}.`
            }

            const fakeMessage: Message = {
                content: []
            }

            if (imageData.ext === 'image/gif') {
                const frames = await parseGifToFrames(imageData.buffer, {
                    strategy: this.config.gifStrategy,
                    frameCount: this.config.gifFrameCount
                })

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
                model,
                this.config,
                fakeMessage
            )

            if (!result) {
                return `Failed to process image from ${url}.`
            }

            return result
        } catch (error) {
            logger.warn(
                `Read image ${url} error, check your chat adapter`,
                error
            )
            return `Read image ${url} error, please check your chat adapter.`
        }
    }
}
