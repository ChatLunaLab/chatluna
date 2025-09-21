import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { marked, Token } from 'marked'
import { logger } from 'koishi-plugin-chatluna'
import { h, Schema } from 'koishi'
import type {} from '@initencounter/vits'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/string'

export class VoiceRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        const baseElements = transformMessageContentToElements(message.content)
        const splitMessages = this._splitMessage(baseElements)
            .flatMap((text) => text.trim().split('\n\n'))
            .filter((text) => text.length > 0)

        logger?.debug(`splitMessages: ${JSON.stringify(splitMessages)}`)

        if (splitMessages.length === 0) {
            return {
                element: []
            }
        }

        if (options.split) {
            return {
                element: await Promise.all(
                    splitMessages.map(async (text) => {
                        return h(
                            'message',
                            await this._renderToVoice(text, options)
                        )
                    })
                )
            }
        } else {
            return {
                element: await this._renderToVoice(
                    splitMessages.join(''),
                    options
                )
            }
        }
    }

    private _splitMessage(messages: h[]): string[] {
        return messages
            .flatMap((message) => {
                if (message.type !== 'text') {
                    return []
                }
                const tokens = renderTokens(
                    marked.lexer(message.attrs['content'] ?? '')
                )

                if (tokens.length === 0 || tokens[0].length === 0) {
                    return message.attrs['content'] ?? ''
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

    schema = Schema.const('voice').i18n({
        'zh-CN': '将回复渲染为语音',
        'en-US': 'Render as voice'
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
