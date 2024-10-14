/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Logger, Schema } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ImageRenderer } from './renders/image'
import { MixedImageRenderer } from './renders/mixed-image'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs/promises'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-image-renderer')
    const plugin = new ChatLunaPlugin<ClientConfig, Config>(
        ctx,
        config,
        'image-renderer',
        false
    )

    const templateDir = path.resolve(
        ctx.baseDir,
        'data/chathub/render_template'
    )

    ctx.on('ready', async () => {
        plugin.registerToService()

        const dirname =
            __dirname?.length > 0 ? __dirname : fileURLToPath(import.meta.url)
        const templateHtmlDir = dirname + '/../resources'

        try {
            await fs.access(templateDir)
        } catch (error) {
            await fs.mkdir(templateDir, { recursive: true })
            await fs.cp(templateHtmlDir, templateDir, { recursive: true })
        }

        ctx.effect(() =>
            ctx.chatluna.renderer.addRenderer('image', (_: Context) => {
                return new ImageRenderer(ctx, config)
            })
        )

        ctx.effect(() =>
            ctx.chatluna.renderer.addRenderer('mixed-image', (_: Context) => {
                return new MixedImageRenderer(ctx, config)
            })
        )
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

export const usage = `
模版路径在[\`data/chathub/render_template/template.html\`](../files/data/chathub/render_template/template.html)，你可以自由更改 html 文件，只需要注意 \${xx} 的格式为渲染时传入的参数，不要随意修改。`

export const inject = ['chatluna', 'puppeteer']

export const name = 'chatluna-image-renderer'
