import { h, Schema } from 'koishi'
import { logger } from 'koishi-plugin-chatluna'
import type {} from 'koishi-plugin-puppeteer'
import type {} from '@initencounter/vits'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/string'
import { Message, RenderMessage, RenderOptions } from '../types'
import { BufferedRenderStreamSession, Renderer } from './base'
import { splitText } from './split'
import { transformAndEscape } from './text'
import { RenderStreamPlan, RenderStreamSession } from './types'

export class MixedVoiceRenderer extends Renderer {
    async render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage> {
        const elements: h[] = []
        const baseElements = transformMessageContentToElements(message.content)
        const text = (await this.renderText(baseElements, options)).element

        if (Array.isArray(text)) {
            elements.push(...text)
        } else {
            elements.push(text)
        }

        const voice = (await this.renderVoice(baseElements, options)).element

        if (Array.isArray(voice)) {
            elements.push(...voice)
        } else {
            elements.push(voice)
        }

        return {
            element: elements
        }
    }

    getStreamPlan(options: RenderOptions): RenderStreamPlan {
        return { mode: 'split' }
    }

    createStreamSession(
        options: RenderOptions,
        plan: RenderStreamPlan
    ): RenderStreamSession {
        return new MixedVoiceStreamSession(options, plan, (text) =>
            this._renderToVoice(text, options)
        )
    }

    async renderText(
        messages: h[],
        options: RenderOptions
    ): Promise<RenderMessage> {
        let transformed = transformAndEscape(messages)

        if (options.split && options.split !== 'none') {
            transformed = transformed.map((element) => h('message', element))
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
            .flatMap((text) => splitText(text.trim(), options.split ?? 'none'))
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

    schema = Schema.const('mixed-voice').i18n({
        'zh-CN': '同时输出语音和文本',
        'en-US': 'Output both voice and text'
    })
}

class MixedVoiceStreamSession extends BufferedRenderStreamSession {
    constructor(
        options: RenderOptions,
        plan: RenderStreamPlan,
        private readonly render: (text: string) => Promise<h>
    ) {
        super(options, plan)
    }

    protected async renderText(text: string) {
        const result: h[] = []
        const elements = transformAndEscape(
            transformMessageContentToElements(text)
        )
        if (this.options.split && this.options.split !== 'none') {
            result.push(...elements.map((el) => h('message', el)))
        } else {
            result.push(...elements)
        }
        result.push(await this.render(text))
        return result
    }
}
