import { Context, h } from 'koishi'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { Config } from '../../config'
import { logger } from '../../index'
import type {} from '@initencounter/sst'
import {
    getImageType,
    getMessageContent,
    hashString
} from 'koishi-plugin-chatluna/utils/string'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type {} from 'koishi-plugin-chatluna-storage-service'
import { Message } from 'koishi-plugin-chatluna'
import { MessageContent, MessageContentComplex } from '@langchain/core/messages'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('read_chat_message', async (session, context) => {
            let message =
                context.command != null ? context.message : session.elements

            message = message as h[] | string

            if (typeof message === 'string') {
                message = [h.text(message)]
            }

            const room = context.options.room

            const transformedMessage =
                await ctx.chatluna.messageTransformer.transform(
                    session,
                    message,
                    room?.model ?? '',
                    undefined,
                    {
                        quote: false,
                        includeQuoteReply: config.includeQuoteReply
                    }
                )

            if (
                transformedMessage.content.length < 1 &&
                getMessageContent(transformedMessage.content).trim().length < 1
            ) {
                return ChainMiddlewareRunStatus.STOP
            }

            context.options.inputMessage = transformedMessage

            return ChainMiddlewareRunStatus.CONTINUE
        })

        .after('resolve_room')

    ctx.chatluna.messageTransformer.intercept(
        'text',
        async (session, element, message) => {
            addMessageContent(message, element.attrs['content'])
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'at',
        async (session, element, message) => {
            const name = element.attrs['name']
            const id = element.attrs['id']

            if (id !== session.bot.selfId) {
                addMessageContent(
                    message,
                    `<at ${name != null ? `name="${name}"` : ''} id="${id}"/>`
                )
            }
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'face',
        async (session, element, message) => {
            const faceXml = `[face:${element.attrs.id}:${element.attrs.name}]`

            addMessageContent(message, faceXml)

            return true
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'img',
        async (session, element, message, model) => {
            const parsedModelInfo =
                model != null
                    ? ctx.chatluna.platform.findModel(model)
                    : undefined

            if (
                parsedModelInfo?.value != null &&
                !parsedModelInfo.value.capabilities.includes(
                    ModelCapabilities.ImageInput
                )
            ) {
                logger.warn(
                    // eslint-disable-next-line max-len
                    `Model "${model}" does not support image input. Please use a model that supports vision capabilities, or install chatluna-image-service plugin to enable image description.`
                )
                return false
            }

            const url = (element.attrs.url ?? element.attrs.src) as string
            const displayUrl =
                url.length > 100 ? url.substring(0, 100) + '...' : url
            logger.debug(`Processing image: ${displayUrl}`)

            if (!ctx.chatluna_storage) {
                return await oldImageRead(ctx, url, message, element)
            }

            const { buffer, ext } = await readImage(ctx, url)

            if (ext == null) {
                return false
            }

            // For GIF images, warn and let image-service handle it
            if (ext === 'image/gif') {
                logger.warn(
                    `Detected GIF image, which is not supported by most models. Please install chatluna-image-service plugin to parse GIF animations.`
                )
                return false
            }

            // Extract clean file extension from MIME type (e.g., "image/png" -> "png")
            const fileExt = ext.includes('/') ? ext.split('/')[1] : ext
            element.attrs['ext'] = fileExt

            let fileName = element.attrs['filename']

            if (fileName == null || fileName.length > 50) {
                fileName = `${await hashString(url, 8)}.${fileExt}`
            }

            logger.debug(`Saving image as temp file: ${fileName}`)

            const tempFile = await ctx.chatluna_storage.createTempFile(
                buffer,
                fileName
            )

            ensureContentArray(message, `[image:${tempFile.url}]`)
            addImageToContent(message, tempFile.url)
            element.attrs['imageUrl'] = tempFile.url
        },
        -100
    )

    async function oldImageRead(
        ctx: Context,
        url: string,
        message: Message,
        element: h
    ) {
        const imageHash = await hashString(url, 8)
        element.attrs['imageHash'] = imageHash

        try {
            const { base64Source, ext } = await readImage(ctx, url)

            if (ext == null) {
                return false
            }

            // For GIF images, warn user
            if (ext === 'image/gif') {
                logger.warn(
                    `Detected GIF image, which is not supported by most models. Please install chatluna-image-service plugin to parse GIF animations.`
                )
                return false
            }

            ensureContentArray(message, `[image:${imageHash}]`)
            addImageToContent(message, base64Source, imageHash)
        } catch (error) {
            const displayUrl =
                url.length > 100 ? url.substring(0, 100) + '...' : url
            logger.warn(
                `Failed to read image from ${displayUrl}. Please check your Koishi chat adapter.`,
                error
            )
        }
    }

    ctx.inject(['sst'], (ctx) => {
        logger.debug('sst service loaded.')

        ctx.effect(() =>
            ctx.chatluna.messageTransformer.intercept(
                'audio',
                async (session, element, message) => {
                    // The sst service only use session
                    const content = await ctx.sst.audio2text(session)
                    logger.debug(`audio2text: ${content}`)
                    message.content += content
                }
            )
        )
    })
}

async function readImage(ctx: Context, url: string) {
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

function addImageToContent(message: Message, imageUrl: string, hash?: string) {
    ;(message.content as MessageContentComplex[]).push({
        type: 'image_url',
        image_url: {
            url: imageUrl,
            ...(hash && { hash })
        }
    })
}

function ensureContentArray(message: Message, fallbackText: string) {
    if (typeof message.content === 'string') {
        message.content = [
            {
                type: 'text',
                text:
                    message.content.trim().length < 1
                        ? fallbackText
                        : message.content
            }
        ]
    }
}

function addMessageContent(message: Message, content: MessageContent) {
    if (typeof message.content === 'string' && typeof content === 'string') {
        message.content += content
        return
    }

    message.content = [
        ...(typeof message.content === 'string'
            ? [{ type: 'text', text: message.content }]
            : message.content),
        ...(typeof content === 'string'
            ? [{ type: 'text', text: content }]
            : content)
    ]
}

declare module '../../chains/chain' {
    export interface ChainMiddlewareName {
        read_chat_message: string
    }
}
