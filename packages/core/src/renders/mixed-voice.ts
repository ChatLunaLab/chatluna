import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from '../render'
import { marked, Token } from 'marked'
import { logger } from '..'
import { Context, h } from 'koishi'
import { Config } from '../config'
import type {} from 'koishi-plugin-puppeteer'
import { transformAndEscape } from './text'
import type {} from '@initencounter/vits'

export default class MixedVoiceRenderer extends Renderer {
    constructor(
        protected readonly ctx: Context,
        protected readonly config: Config
    ) {
        super(ctx, config)
    }

    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        const elements: h[] = []

        const renderText = (await this.renderText(message, options)).element

        if (renderText instanceof Array) {
            elements.push(...renderText)
        } else {
            elements.push(renderText)
        }

        const renderVoice = (await this.renderVoice(message, options)).element

        if (renderVoice instanceof Array) {
            elements.push(...renderVoice)
        } else {
            elements.push(renderVoice)
        }

        return {
            element: elements
        }
    }

    async renderText(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        let transformed = transformAndEscape(message.content)

        if (options.split) {
            transformed = transformed.map((element) => {
                return h('message', element)
            })
        }

        return {
            element: transformed
        }
    }

    async renderVoice(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        const splitMessages = this._splitMessage(message.content)
            .flatMap((text) => text.trim().split('\n\n'))
            .filter((text) => text.length > 0)

        logger.debug(`splitMessages: ${JSON.stringify(splitMessages)}`)

        return {
            element: await this._renderToVoice(splitMessages.join(''), options)
        }
    }

    private _splitMessage(message: string): string[] {
        const tokens = renderTokens(marked.lexer(message))

        if (tokens.length === 0 || tokens[0].length === 0) {
            return [message]
        }

        return tokens
    }

    private _renderToVoice(text: string, options: RenderOptions) {
        return this.ctx.vits.say({
            speaker_id: options?.voice?.speakerId ?? undefined,
            input: text
        })
    }
}

function renderToken(token: Token): string {
    if (
        token.type === 'text' ||
        //     token.type === "space" ||
        token.type === 'heading' ||
        token.type === 'em' ||
        token.type === 'strong' ||
        token.type === 'del' ||
        token.type === 'codespan' ||
        token.type === 'list_item' ||
        token.type === 'blockquote'
        //   || token.type === "code"
    ) {
        return token.text
    }

    return token.raw
}

function renderTokens(tokens: Token[]): string[] {
    return tokens.map(renderToken)
}
