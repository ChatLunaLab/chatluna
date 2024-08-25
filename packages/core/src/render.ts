import { Context } from 'koishi'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { Config } from './config'
import { Message, RenderMessage, RenderOptions, RenderType } from './types'
import { ImageRenderer } from './renders/image'
import { TextRenderer } from './renders/text'
import { VoiceRenderer } from './renders/voice'
import { RawRenderer } from './renders/raw'
import { MixedImageRenderer } from './renders/mixed-image'
import { MixedVoiceRenderer } from './renders/mixed-voice'
import { Renderer } from './renders/default'

export class DefaultRenderer {
    defaultOptions: RenderOptions

    private allRenderers: Record<
        string,
        (ctx: Context, config: Config) => Renderer
    > = {}

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

        this.allRenderers = {
            image: (ctx: Context, config: Config) =>
                new ImageRenderer(ctx, config),
            text: (ctx: Context, config: Config) =>
                new TextRenderer(ctx, config),
            voice: (ctx: Context, config: Config) =>
                new VoiceRenderer(ctx, config),
            raw: (ctx: Context, config: Config) => new RawRenderer(ctx, config),
            'mixed-image': (ctx: Context, config: Config) =>
                new MixedImageRenderer(ctx, config),
            'mixed-voice': (ctx: Context, config: Config) =>
                new MixedVoiceRenderer(ctx, config)
        }
    }

    public async render(
        message: Message,
        options: RenderOptions = this.defaultOptions
    ): Promise<RenderMessage[]> {
        try {
            const result: RenderMessage[] = []

            const currentRenderer = await this._getRenderer(options.type)
            const rawRenderer =
                options.type === 'raw'
                    ? currentRenderer
                    : await this._getRenderer('raw')

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

    private async _getRenderer(type: string): Promise<Renderer> {
        return this.allRenderers[type](this.ctx, this.config)
    }
}
