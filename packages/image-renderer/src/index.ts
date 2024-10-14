/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Logger, Schema } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ImageRenderer } from './renders/image'
import { MixedImageRenderer } from './renders/mixed-image'
export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-search-service')
    const plugin = new ChatLunaPlugin<ClientConfig, Config>(
        ctx,
        config,
        'image-renderer',
        false
    )

    ctx.on('ready', async () => {
        plugin.registerToService()

        ctx.chatluna.renderer.addRenderer('image', (ctx: Context) => {
            return new ImageRenderer(ctx)
        })

        ctx.chatluna.renderer.addRenderer('mixed-image', (ctx: Context) => {
            return new MixedImageRenderer(ctx)
        })
    })
}

export interface Config extends ChatLunaPlugin.Config {
    qrCode: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        qrCode: Schema.boolean().default(false)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna', 'puppeteer']

export const name = 'chatluna-image-renderer'
