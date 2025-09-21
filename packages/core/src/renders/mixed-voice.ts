import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { marked, Token } from 'marked'
import { logger } from 'koishi-plugin-chatluna'
import { h, Schema } from 'koishi'
import type {} from 'koishi-plugin-puppeteer'
import { transformAndEscape } from './text'
import type {} from '@initencounter/vits'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/string'

export class MixedVoiceRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        const elements: h[] = []

        const baseElements = transformMessageContentToElements(message.content)

        const renderText = (await this.renderText(baseElements, options))
            .element

        if (renderText instanceof Array) {
            elements.push(...renderText)
        } else {
            elements.push(renderText)
        }

        const renderVoice = (await this.renderVoice(baseElements, options))
            .element

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
        messages: h[],
        options: RenderOptions
    ): Promise<RenderMessage> {
        let transformed = transformAndEscape(messages)

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
        messages: h[],
        options: RenderOptions
    ): Promise<RenderMessage> {
        const splitMessages = this._splitMessage(messages)
            .flatMap((text) => text.trim().split('\n\n'))
            .filter((text) => text.length > 0)

        logger?.debug(`splitMessages: ${JSON.stringify(splitMessages)}`)

        if (splitMessages.length === 0) {
            return {
                element: []
            }
        }

        return {
            element: await this._renderToVoice(splitMessages.join(''), options)
        }
    }

    private _splitMessage(messages: h[]): string[] {
        return messages
            .flatMap((message) => {
                if (message.type !== 'text') {
                    return []
                }
                const tokens = renderTokens(
                    marked.lexer(message.attrs['content'])
                )

                if (tokens.length === 0 || tokens[0].length === 0) {
                    return message.attrs['content']
                }

                return tokens
            })
            .filter(Boolean)
    }

    private _renderToVoice(text: string, options: RenderOptions) {
        return this.ctx.vits.say(
            Object.assign(
                {
                    speaker_id: options?.voice?.speakerId ?? 0,
                    input: text
                },
                {
                    session: options.session
                }
            )
        )
    }

    schema = Schema.const('mixed-voice').i18n({
        'zh-CN': '同时输出语音和文本',
        'en-US': 'Output both voice and text'
    })
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
