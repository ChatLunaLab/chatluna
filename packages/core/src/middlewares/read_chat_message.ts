import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { request } from '../utils/request';

const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {



    chain.middleware("read_chat_message", async (session, context) => {

        let message = context.command != null ? context.message : session.elements

        if (context.options.message != null || message instanceof String) {
            return ChainMiddlewareRunStatus.SKIPPED
        }

        message = message as h[] | string

        if (typeof message === "string") {
            message = [h.text(message)]
        }

        const transformedMessage = ctx.chathub.messageTransformer.transform(session, message)

        if (transformedMessage.content.length < 1) {
            return ChainMiddlewareRunStatus.STOP
        }

        context.options.inputMessage = transformedMessage

        return ChainMiddlewareRunStatus.CONTINUE

    }).after("lifecycle-prepare")


    ctx.chathub.messageTransformer.intercept('text', async (session, element, message) => {
        message.content += element.attrs["content"]
    })

    ctx.chathub.messageTransformer.intercept('at', async (session, element, message) => {
        const name = element.attrs["name"]
        const id = element.attrs["id"]

        if (name && id !== session.bot.selfId) {
            message.content += `@${name}`
        }
    })

    ctx.chathub.messageTransformer.intercept('image', async (session, element, message) => {
        const images: string[] = message.additional_kwargs.images ?? []

        const url = element.attrs["url"] as string

        logger.debug(`image url: ${url}`)

        if (url.startsWith("data:image")) {
            images
                .push(url)
        } else {
            const response = await request.fetch(url)

            // support any text
            const ext = url.match(/\.([^.]*)$/)?.[1]

            const buffer = await response.arrayBuffer()

            const base64 = Buffer.from(buffer).toString("base64")

            images.push(`data:image/${ext ?? "png"};base64,${base64}`)
        }

        message.additional_kwargs.images = images
    })
}

declare module '../chains/chain' {
    export interface ChainMiddlewareName {
        "read_chat_message": string
    }
}