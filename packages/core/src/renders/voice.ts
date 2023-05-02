
import { RenderMessage, RenderOptions, SimpleMessage } from '../types';
import { Renderer } from '../render';
import { marked } from 'marked';
import { createLogger } from '../utils/logger';
import { h } from 'koishi';
import type {} from "@initencounter/vits"

const logger = createLogger("@dingyi222666/chathub/renderer/voice")

export default class VoiceRenderer extends Renderer {

    async render(message: SimpleMessage, options: RenderOptions): Promise<RenderMessage> {

        const splitMessages = this.splitMessage(message.content).flatMap((text) => text.trim().split("\n\n"))
            .filter((text) => text.length > 0)



        logger.debug(`splitMessages: ${JSON.stringify(splitMessages)}`)

        if (options.split) {
            return {
                element: await Promise.all(splitMessages.map(async (text) => {
                    return h("message", await this.renderToVoice(text, options))
                }))
            }
        } else {
            return {
                element: await this.renderToVoice(splitMessages.join(""), options)
            }
        }

    }

    private splitMessage(message: string): string[] {
        return renderTokens(marked.lexer(message))
    }

    private renderToVoice(text: string, options: RenderOptions) {
        return this.ctx.vits.say({
            speaker_id: options?.voice?.speakerId ?? undefined,
            input: text,
        })
    }

}

function renderToken(token: marked.Token): string {
    if (token.type === "text" ||
        //     token.type === "space" ||
        token.type === "heading" ||
        token.type === "em" ||
        token.type === "strong" ||
        token.type === "del" ||
        token.type === "codespan" ||
        token.type === "list_item" ||
        token.type === "blockquote" ||
        token.type === "code"
    ) {
        return token.text
    }



    return token.raw
}

function renderTokens(tokens: marked.Token[]): string[] {
    return tokens.map(renderToken)
}
