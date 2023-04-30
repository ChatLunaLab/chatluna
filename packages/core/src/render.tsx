import { Context, Logger, h } from "koishi";
import { Config } from "./config";
import { Message, RenderMessage, RenderOptions } from "./types";
import { buildTextElement } from "./chat";
import { transform } from "koishi-plugin-markdown";
import "@initencounter/vits";

export class Render {
    defaultOptions: RenderOptions;

    constructor(private readonly ctx: Context, config: Config) {
        this.defaultOptions = {
            type: config.outputMode as "raw",
        };
    }

    public async render(
        message: Message,
        options: RenderOptions = this.defaultOptions
    ): Promise<RenderMessage[]> {
        if (options.type === "text") {
            return this.renderMarkdown(message);
        }

        if (options.type === "voice") {
            return await this.renderVoice(message, options);
        }

        return this.renderRaw(message);
    }

    public async renderVoice(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage[]> {
        const result: RenderMessage[] = [];

        if (message.content.length > 0) {
            result.push({
                element: await this.ctx.vits.say({
                    speaker_id: options?.voice?.speakerId ?? undefined,
                    input: message.content,
                }),
            });
        }

        if (message.additionalReplyMessages) {
            message.additionalReplyMessages.forEach((message) => {
                if (message.content.length === 0) {
                    return;
                }
                result.push({
                    element: buildTextElement(message.content),
                });
            });
        }

        return result;
    }

    public renderMarkdown(message: Message): RenderMessage[] {
        const result: RenderMessage[] = [];

        if (message.content.length > 0) {
            result.push({
                element: transform(message.content),
            });
        }

        if (message.additionalReplyMessages) {
            message.additionalReplyMessages.forEach((message) => {
                if (message.content.length === 0) {
                    return;
                }
                result.push({
                    element: transform(message.content),
                });
            });
        }

        return result;
    }

    public renderRaw(message: Message): RenderMessage[] {
        const result: RenderMessage[] = [];

        if (message.content.length > 0) {
            result.push({
                element: buildTextElement(message.content),
            });
        }

        if (message.additionalReplyMessages) {
            message.additionalReplyMessages.forEach((message) => {
                if (message.content.length === 0) {
                    return;
                }
                result.push({
                    element: buildTextElement(message.content),
                });
            });
        }

        return result;
    }
}
