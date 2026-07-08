import { h, Schema } from 'koishi'
import { logger } from 'koishi-plugin-chatluna'
import type {} from '@initencounter/vits'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/string'
import { Message, RenderMessage, RenderOptions } from '../types'
import { BufferedRenderStreamSession, Renderer } from './base'
import { splitText } from './split'
import { RenderStreamPlan, RenderStreamSession } from './types'

export class VoiceRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        const baseElements = transformMessageContentToElements(message.content)
        const splitMessages = this._splitMessage(baseElements)
            .flatMap((text) => splitText(text.trim(), options.split ?? 'none'))
            .filter((text) => text.length > 0)

        logger?.debug(`splitMessages: ${JSON.stringify(splitMessages)}`)

        if (splitMessages.length === 0) {
            return {
                element: []
            }
        }

        if (options.split && options.split !== 'none') {
            return {
                element: await Promise.all(
                    splitMessages.map(async (text) =>
                        h('message', await this._renderToVoice(text, options))
                    )
                )
            }
        }

        return {
            element: await this._renderToVoice(splitMessages.join(''), options)
        }
    }

    getStreamPlan(options: RenderOptions): RenderStreamPlan {
        return { mode: 'split' }
    }

    createStreamSession(
        options: RenderOptions,
        plan: RenderStreamPlan
    ): RenderStreamSession {
        return new VoiceStreamSession(options, plan, (text) =>
            this._renderToVoice(text, options)
        )
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

class VoiceStreamSession extends BufferedRenderStreamSession {
    constructor(
        options: RenderOptions,
        plan: RenderStreamPlan,
        private readonly render: (text: string) => Promise<h>
    ) {
        super(options, plan)
    }

    protected async renderText(text: string) {
        return [
            this.options.split && this.options.split !== 'none'
                ? h('message', await this.render(text))
                : await this.render(text)
        ]
    }
}
