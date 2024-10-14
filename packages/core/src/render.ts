import { Context, Schema } from 'koishi'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { Config } from './config'
import { Message, RenderMessage, RenderOptions, RenderType } from './types'
import { TextRenderer } from './renders/text'
import { VoiceRenderer } from './renders/voice'
import { RawRenderer } from './renders/raw'
import { MixedVoiceRenderer } from './renders/mixed-voice'
import { Renderer } from './renders/default'

export class DefaultRenderer {
    defaultOptions: RenderOptions

    private renderers: Record<string, Renderer> = {}

    constructor(
        protected readonly ctx: Context,
        protected readonly config: Config
    ) {
        this.defaultOptions = {
            type: config.outputMode as RenderType,
            split: config.splitMessage,
            voice: {
                speakerId: config.voiceSpeakId
            }
        }

        this.addRenderer('text', (ctx: Context) => new TextRenderer(ctx))

        this.addRenderer('voice', (ctx: Context) => new VoiceRenderer(ctx))

        this.addRenderer('raw', (ctx: Context) => new RawRenderer(ctx))
        this.addRenderer(
            'mixed-voice',
            (ctx: Context) => new MixedVoiceRenderer(ctx)
        )
    }

    public async render(
        message: Message,
        options: RenderOptions = this.defaultOptions
    ): Promise<RenderMessage[]> {
        try {
            const result: RenderMessage[] = []

            const currentRenderer = await this.getRenderer(options.type)
            const rawRenderer =
                options.type === 'raw'
                    ? currentRenderer
                    : await this.getRenderer('raw')

            result.push(await currentRenderer.render(message, options))

            if (message.additionalReplyMessages) {
                for (const additionalMessage of message.additionalReplyMessages) {
                    result.push(
                        await rawRenderer.render(additionalMessage, options)
                    )
                }
            }

            return result
        } catch (e) {
            throw new ChatLunaError(ChatLunaErrorCode.RENDER_ERROR, e)
        }
    }

    public addRenderer(
        type: string,
        renderer: (ctx: Context, config: Config) => Renderer
    ): () => void {
        this.renderers[type] = renderer(this.ctx, this.config)

        this.updateSchema()
        return () => this.removeRenderer(type)
    }

    public removeRenderer(type: string): void {
        delete this.renderers[type]

        this.updateSchema()
    }

    async getRenderer(type: string): Promise<Renderer> {
        return this.renderers[type]
    }

    public updateSchema() {
        this.ctx.schema.set(
            'output-mode',
            Schema.union(this._getAllRendererScheme())
        )
    }

    private _getAllRendererScheme(): Schema[] {
        return Object.values(this.renderers).map((key) => key.schema)
    }
}

export * from './renders/default'
