import { Context, h } from 'koishi'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { Config } from '../../config'
import { logger } from '../../index'
import type {} from '@initencounter/sst'
import { hashString } from 'koishi-plugin-chatluna/utils/string'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type {} from 'koishi-plugin-chatluna-storage-service'
import { Message } from 'koishi-plugin-chatluna'
import { MessageContentComplex } from '@langchain/core/messages'

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
                    room.model
                )

            if (transformedMessage.content.length < 1) {
                return ChainMiddlewareRunStatus.STOP
            }

            context.options.inputMessage = transformedMessage

            return ChainMiddlewareRunStatus.CONTINUE
        })

        .after('resolve_room')

    ctx.chatluna.messageTransformer.intercept(
        'text',
        async (session, element, message) => {
            message.content += element.attrs['content']
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'at',
        async (session, element, message) => {
            const name = element.attrs['name']
            const id = element.attrs['id']

            if (id !== session.bot.selfId) {
                message.content += `<at ${name != null ? `name="${name}"` : ''} id="${id}"/>`
            }
        }
    )

    const ensureContentArray = (message: Message, fallbackText: string) => {
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

    const addImageToContent = (
        message: Message,
        imageUrl: string,
        hash?: string
    ) => {
        ;(message.content as MessageContentComplex[]).push({
            type: 'image_url',
            image_url: {
                url: imageUrl,
                ...(hash && { hash })
            }
        })
    }

    ctx.chatluna.messageTransformer.intercept(
        'img',
        async (session, element, message, model) => {
            const parsedModelInfo = ctx.chatluna.platform.getModelInfo(model)

            if (
                !parsedModelInfo.capabilities.includes(
                    ModelCapabilities.ImageInput
                )
            ) {
                logger.warn(
                    `model ${model} does not support image input, please use a model that supports image input.

                    If you are install image-service plugin, please ignore this warning.`.trimStart()
                )
                return false
            }

            const url = (element.attrs.url ?? element.attrs.src) as string
            logger.debug(`image url: ${url}`)

            if (!ctx.chatluna_storage) {
                return await oldImageRead(ctx, url, message, element)
            }

            const { buffer } = await readImage(ctx, url)
            const fileName = `${await hashString(url, 8)}.${element.attrs.ext}`
            const tempFile = await ctx.chatluna_storage.createTempFile(
                buffer,
                fileName
            )

            ensureContentArray(message, `[image:${tempFile.url}]`)
            addImageToContent(message, tempFile.url)
            element.attrs['imageUrl'] = tempFile.url
        }
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
            const { base64Source } = await readImage(ctx, url)
            ensureContentArray(message, `[image:${imageHash}]`)
            addImageToContent(message, base64Source, imageHash)
        } catch (error) {
            logger.warn(
                `read image ${url} error, check your koishi chat adapter`,
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
        return {
            base64Source: url,
            buffer: Buffer.from(url.split(',')[1], 'base64')
        }
    }

    const response = await ctx.http(url, {
        responseType: 'arraybuffer',
        method: 'get',
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
        }
    })

    // support any text
    let ext = url.match(/\.([^.]*)$/)?.[1]

    if (!['png', 'jpeg'].includes(ext)) {
        ext = 'jpeg'
    }

    const buffer = Buffer.from(response.data)

    const base64 = buffer.toString('base64')

    return {
        base64Source: `data:image/${ext ?? 'jpeg'};base64,${base64}`,
        buffer
    }
}

declare module '../../chains/chain' {
    export interface ChainMiddlewareName {
        read_chat_message: string
    }
}
