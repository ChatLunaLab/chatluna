import { h } from 'koishi';
import { Config } from './config';
import { Message } from './types';
import { buildTextElement } from './chat';

export class Render {

    constructor(
        private readonly config: Config
    ) {

    }


    public async render(message: Message): Promise<h[]> {
        if (this.config.outputMode === "raw") {
            return this.renderRaw(message)
        }

        if (this.config.outputMode === "voice") {
            return this.renderVoice(message)
        }

        // ?
        return []
    }

    public async renderVoice(message: Message): Promise<h[]> {
        throw new Error("Method not implemented.");
    }

    public async renderRaw(message: Message): Promise<h[]> {
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