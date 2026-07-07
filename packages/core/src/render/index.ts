import { Context, h, Schema } from 'koishi'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { ChainMiddlewareContext } from '../chains/chain'
import { Config } from '../config'
import { Message, RenderMessage, RenderOptions, RenderType } from '../types'
import { KoishiElementRenderer } from './koishi-element'
import { MixedVoiceRenderer } from './mixed-voice'
import { PureTextRenderer } from './pure-text'
import { RawRenderer } from './raw'
import { Renderer } from './base'
import { ReplyStream, ReplyStreamOptions } from './stream'
import { TextRenderer } from './text'
import { VoiceRenderer } from './voice'

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

        ctx.inject(['chatluna'], (ctx) => {
            this.addRenderer('text', () => new TextRenderer(ctx))
            this.addRenderer('voice', () => new VoiceRenderer(ctx))
            this.addRenderer('raw', () => new RawRenderer(ctx))
            this.addRenderer('mixed-voice', () => new MixedVoiceRenderer(ctx))
            this.addRenderer(
                'koishi-element',
                () => new KoishiElementRenderer(ctx)
            )
            this.addRenderer('pure-text', () => new PureTextRenderer(ctx))
        })
    }

    public async render(
        message: Message,
        options: RenderOptions = this.defaultOptions
    ): Promise<RenderMessage[]> {
        try {
            const result: RenderMessage[] = []

            options = Object.assign({}, this.defaultOptions, options)

            const currentRenderer = this.getRenderer(options.type)
            const rawRenderer =
                options.type === 'raw'
                    ? currentRenderer
                    : this.getRenderer('raw')

            if (message.additionalReplyMessages) {
                for (const msg of message.additionalReplyMessages) {
                    const elements = await rawRenderer
                        .render(msg, options)
                        .then((r) => r.element)

                    result.push({
                        element: h(
                            'message',
                            { forward: true },
                            Array.isArray(elements) ? elements : [elements]
                        )
                    })
                }
            }

            result.push(await currentRenderer.render(message, options))

            return result
        } catch (e) {
            throw new ChatLunaError(ChatLunaErrorCode.RENDER_ERROR, e)
        }
    }

    public createStream(
        context: ChainMiddlewareContext,
        options: ReplyStreamOptions
    ) {
        const renderOptions = Object.assign(
            {},
            this.defaultOptions,
            options.renderOptions,
            { session: context.session }
        )
        return new ReplyStream(
            this.ctx,
            this.config,
            context,
            this.getRenderer(renderOptions.type),
            {
                ...options,
                renderOptions,
                renderMessage: (message) => this.render(message, renderOptions),
                renderAdditional: (message) =>
                    this.renderAdditionalMessages(message, renderOptions)
            }
        )
    }

    private async renderAdditionalMessages(
        message: Message,
        options: RenderOptions
    ) {
        if (!message.additionalReplyMessages) return []

        const rawRenderer = this.getRenderer('raw')
        const result: h[][] = []

        for (const msg of message.additionalReplyMessages) {
            const elements = await rawRenderer
                .render(msg, options)
                .then((r) => r.element)

            result.push([
                h(
                    'message',
                    { forward: true },
                    Array.isArray(elements) ? elements : [elements]
                )
            ])
        }

        return result
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

    getRenderer(type: string) {
        return this.renderers[type]
    }

    public updateSchema() {
        if (!this.ctx.scope.isActive) {
            return
        }
        this.ctx.schema.set(
            'output-mode',
            Schema.union(this._getAllRendererScheme())
        )
    }

    private _getAllRendererScheme(): Schema[] {
        return Object.values(this.renderers).map((key) => key.schema)
    }

    get rendererTypeList() {
        return Object.keys(this.renderers)
    }
}

export * from './base'
export * from './types'
