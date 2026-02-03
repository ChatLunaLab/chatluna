/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config, logger } from '.'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ChatLunaToolRunnable,
    ModelCapabilities
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    addImageToContent,
    addTextToContent,
    parseGifToFrames,
    processImageWithModel,
    readImage
} from './utils'
import { ComputedRef, Message } from 'koishi-plugin-chatluna'

export function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin,
    imageModelRef2: ComputedRef<ChatLunaChatModel | undefined>
) {
    if (!config.enableImageTool) {
        return
    }

    plugin.registerTool('read_image', {
        selector() {
            return true
        },
        createTool() {
            return new ReadImageTool(ctx, config, () => imageModelRef2)
        }
    })
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
