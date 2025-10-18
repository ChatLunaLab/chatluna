import {
    HumanMessage,
    MessageContent,
    MessageContentComplex,
    MessageContentText
} from '@langchain/core/messages'
import { Message } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    getImageType,
    getMessageContent,
    isMessageContentImageUrl
} from 'koishi-plugin-chatluna/utils/string'
import { Context } from 'koishi'
import { Config, logger } from '.'
import { GifReader } from 'omggif'
import { Jimp } from 'jimp'

export interface GifExtractionConfig {
    strategy: 'first' | 'head' | 'average'
    frameCount: number
}

export async function extractGifFrames(
    buffer: Buffer,
    config: GifExtractionConfig
): Promise<Buffer[]> {
    try {
        const reader = new GifReader(buffer)
        const totalFrames = reader.numFrames()

        if (totalFrames === 0) {
            throw new Error('No frames found in GIF')
        }

        const width = reader.width
        const height = reader.height

        let frameIndices: number[] = []

        switch (config.strategy) {
            case 'first':
                frameIndices = [0]
                break

            case 'head': {
                const count = Math.min(config.frameCount, totalFrames)
                frameIndices = Array.from({ length: count }, (_, i) => i)
                break
            }

            case 'average': {
                const count = Math.min(config.frameCount, totalFrames)
                if (count >= totalFrames) {
                    frameIndices = Array.from(
                        { length: totalFrames },
                        (_, i) => i
                    )
                } else if (count === 1) {
                    // Special case: single frame, pick the first one
                    frameIndices = [0]
                } else {
                    // Use span (totalFrames - 1) to ensure first and last frames are included
                    const step = (totalFrames - 1) / (count - 1)
                    frameIndices = Array.from({ length: count }, (_, i) =>
                        Math.floor(i * step)
                    )
                }
                break
            }
        }

        const frameBuffers: Buffer[] = []
        const frameRGBA = new Uint8ClampedArray(width * height * 4)

        for (const frameIndex of frameIndices) {
            reader.decodeAndBlitFrameRGBA(frameIndex, frameRGBA)

            const image = new Jimp({
                data: Buffer.from(frameRGBA),
                width,
                height
            })

            const pngBuffer = await image.getBuffer('image/png')
            frameBuffers.push(pngBuffer)
        }

        return frameBuffers
    } catch (error) {
        logger.error('Failed to extract GIF frames:', error)
        throw error
    }
}

export async function parseGifToFrames(
    buffer: Buffer,
    config: GifExtractionConfig
): Promise<string[]> {
    const frameBuffers = await extractGifFrames(buffer, config)
    return frameBuffers.map((frameBuffer) => {
        const base64 = frameBuffer.toString('base64')
        return `data:image/png;base64,${base64}`
    })
}

export async function readImage(ctx: Context, url: string) {
    if (url.startsWith('data:image') && url.includes('base64')) {
        const buffer = Buffer.from(url.split(',')[1], 'base64')
        const ext = getImageType(buffer)

        return {
            base64Source: url,
            buffer,
            ext
        }
    }

    try {
        const response = await ctx.http(url, {
            responseType: 'arraybuffer',
            method: 'get',
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
            }
        })

        const buffer = Buffer.from(response.data)

        const base64 = buffer.toString('base64')

        const ext = getImageType(buffer)

        return {
            base64Source: `data:${ext};base64,${base64}`,
            buffer,
            ext
        }
    } catch (error) {
        logger.error(`Failed to read image from ${url}:`, error)
        return {
            base64Source: null,
            buffer: null,
            ext: null
        }
    }
}
export async function processImageWithModel(
    model: ChatLunaChatModel,
    config: Config,
    message: Message
) {
    const images = extractImages(message.content)
    if (images.length === 0) return null

    try {
        const content: MessageContentComplex[] = [
            { type: 'text', text: config.imagePrompt } as MessageContentText,
            ...images
        ]

        const result = await model.invoke([new HumanMessage({ content })])

        return config.imageInsertPrompt.replace(
            '{img}',
            getMessageContent(result.content)
        )
    } catch (error) {
        logger.warn('Failed to process image with model', error)
        return null
    }
}

export const addImageToContent = (message: Message, imageUrl: string) => {
    if (typeof message.content === 'string') {
        message.content = [
            {
                type: 'text',
                text: message.content
            }
        ]
    }
    ;(message.content as MessageContentComplex[]).push({
        type: 'image_url',
        image_url: {
            url: imageUrl
        }
    })
}

export const addTextToContent = (message: Message, text: string) => {
    if (typeof message.content === 'string') {
        message.content += text
        return
    }

    const content = message.content as MessageContentComplex[]
    const lastItem = content[content.length - 1]

    if (lastItem && lastItem.type === 'text') {
        lastItem.text += text
    } else {
        content.push({
            type: 'text',
            text
        })
    }
}

export const extractImages = (content: MessageContent) =>
    Array.isArray(content)
        ? content.filter((item: MessageContentComplex) =>
              isMessageContentImageUrl(item)
          )
        : []
