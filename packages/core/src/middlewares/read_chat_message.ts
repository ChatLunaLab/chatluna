import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';

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

        const transformedMessage = ctx.chathub.messageTransformer.transform(message)

        if (transformedMessage.content.length < 1) {
            return ChainMiddlewareRunStatus.STOP
        }

        context.options.inputMessage = transformedMessage

        return ChainMiddlewareRunStatus.CONTINUE

    }).after("lifecycle-prepare")


    ctx.chathub.messageTransformer.intercept('text', async (element, message) => {
        message.content += element.attrs["content"]
    })

    ctx.chathub.messageTransformer.intercept('at', async (element, message) => {
        const name = element.attrs["name"]

        if (name) {
            message.content += `@${name}`
        }
    })

    ctx.chathub.messageTransformer.intercept('image', async (element, message) => {
        const images: string[] = message.additional_kwargs.images ?? []

        images.push(element.attrs["url"])

        message.additional_kwargs.images = images
    })
}

declare module '../chains/chain' {
    export interface ChainMiddlewareName {
        "read_chat_message": string
    }
}