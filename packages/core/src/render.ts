import { Context, h } from 'koishi';
import { Config } from './config';
import { Message, RenderType, RenderOptions } from './types';
import { buildTextElement } from './chat';
import "@initencounter/vits"

export class Render {

    defaultOptions: RenderOptions

    constructor(
        private readonly ctx: Context,
        private readonly config: Config
    ) {

        this.defaultOptions = {
            type: config.outputMode as "raw",
        }
    }

    public async render(message: Message, options: RenderOptions = this.defaultOptions): Promise<h[]> {
        if (options.type === "raw") {
            return this.renderRaw(message)
        }

        if (options.type === "voice") {
            return (await this.renderVoice(message, options))
        }

        // ?
        return []
    }

    public async renderVoice(message: Message, options: RenderOptions): Promise<h[]> {
        const result: h[] = []

        if (message.content.length > 0) {
            result.push(await this.ctx.vits.say({
                speaker_id: options?.voice?.speakerId ?? undefined,
                input: message.content
            }))
        }

        if (message.additionalReplyMessages) {
            result.push(...message.additionalReplyMessages.map((message) => buildTextElement(message.content)))
        }

        return result
    }

    public renderRaw(message: Message): h[] {
        const result: h[] = []

        if (message.content.length > 0) {
            result.push(buildTextElement(message.content))
        }

        if (message.additionalReplyMessages) {
            result.push(...message.additionalReplyMessages.map((message) => buildTextElement(message.content)))
        }

        return result

    }
}