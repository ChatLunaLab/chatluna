
import { RenderMessage, RenderOptions, Message } from '../types';
import { Renderer } from '../render';
import { marked } from 'marked';
import { createLogger } from '../llm-core/utils/logger';
import { h } from 'koishi';
import type { } from "@initencounter/vits"

const logger = createLogger("@dingyi222666/chathub/renderer/voice")

export default class VoiceRenderer extends Renderer {

    async render(message: Message, options: RenderOptions): Promise<RenderMessage> {

        const splitMessages = this._splitMessage(message.content).flatMap((text) => text.trim().split("\n\n"))
            .filter((text) => text.length > 0)


        logger.debug(`splitMessages: ${JSON.stringify(splitMessages)}`)

        if (options.split) {
            return {
                element: await Promise.all(splitMessages.map(async (text) => {
                    return h("message", await this._renderToVoice(text, options))
                }))
            }
        } else {
            return {
                element: await this._renderToVoice(splitMessages.join(""), options)
            }
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
