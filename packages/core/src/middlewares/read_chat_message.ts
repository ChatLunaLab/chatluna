import { Context, h } from 'koishi'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { Config } from '../config'
import { logger } from '../index'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('read_chat_message', async (session, context) => {
            let message =
                context.command != null ? context.message : session.elements

            message = message as h[] | string

            if (typeof message === 'string') {
                message = [h.text(message)]
            }

            const transformedMessage =
                await ctx.chatluna.messageTransformer.transform(
                    session,
                    message
                )

            if (transformedMessage.content.length < 1) {
                return ChainMiddlewareRunStatus.STOP
            }

            context.options.inputMessage = transformedMessage

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('lifecycle-prepare')
        .before('resolve_room')

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

            if (name && id !== session.bot.selfId) {
                message.content += `[at:${name}:${id}]`
            }
        }
    )

    ctx.chatluna.messageTransformer.intercept(
        'img',
        async (session, element, message) => {
            const images: string[] = message.additional_kwargs.images ?? []

            const url = (element.attrs.url ?? element.attrs.src) as string

            logger.debug(`image url: ${url} ${element.attrs}`)

            if (url.startsWith('data:image') && url.includes('base64')) {
                images.push(url)
            } else {
                const response = await ctx.http(url, {
                    responseType: 'arraybuffer',
                    method: 'get'
                })

                // support any text
                let ext = url.match(/\.([^.]*)$/)?.[1]

                if (!['png', 'jpeg'].includes(ext)) {
                    ext = 'jpeg'
                }

                const buffer = response.data

                const base64 = Buffer.from(buffer).toString('base64')

                images.push(`data:image/${ext ?? 'jpeg'};base64,${base64}`)
            }

            message.additional_kwargs.images = images

            if (message.content?.length < 1 && session.text.length < 1) {
                message.content = 'what is this?'
            }
        }
    )
}

declare module '../chains/chain' {
    export interface ChainMiddlewareName {
        read_chat_message: string
    }
}
