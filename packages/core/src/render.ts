import { Context } from "koishi";
import { Config } from "./config";
import { Message, RenderMessage, RenderOptions, RenderType, SimpleMessage } from "./types";


export abstract class Renderer {
    constructor(protected readonly ctx: Context, protected readonly config: Config) { }

    abstract render(message: SimpleMessage, options: RenderOptions): Promise<RenderMessage>
}

export class DefaultRenderer {
    defaultOptions: RenderOptions;


    private allRenderers: Record<string, Renderer> = {}

    constructor(protected readonly ctx: Context,protected readonly config: Config) {
        this.defaultOptions = {
            type: config.outputMode as RenderType
        };
    }

    public async render(
        message: Message,
        options: RenderOptions = this.defaultOptions
    ): Promise<RenderMessage[]> {
        const result: RenderMessage[] = [];

        const currentRenderer = await this.getRenderer(options.type);
        const rawRenderer = options.type === "raw" ? currentRenderer : await this.getRenderer("raw");


        result.push(await currentRenderer.render(message, options));

        if (message.additionalReplyMessages) {
            for (const additionalMessage of message.additionalReplyMessages) {
                result.push(await rawRenderer.render(additionalMessage, options));
            }
        }

        return result;
    }

    private async getRenderer(type: string): Promise<Renderer> {
        let renderer = this.allRenderers[type];

        if (renderer) {
            return renderer;
        }

        const importRenderer = await require(`./renders/${type}.js`)
        renderer = new importRenderer.default(this.ctx, this.config);

        this.allRenderers[type] = renderer;
        return renderer;
    }

}

