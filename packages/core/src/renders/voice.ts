import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
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
        return messages.flatMap((message) => message.toString()).filter(Boolean)
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
