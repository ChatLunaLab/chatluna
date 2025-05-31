/* eslint-disable max-len */
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Logger, Schema } from 'koishi'
import { plugin as plugins } from './plugin'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'

export let logger: Logger
export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, 'plugin-common', false)
    logger = createLogger(ctx, 'chatluna-plugin-common')

    ctx.on('ready', async () => {
        plugin.registerToService()
        await plugins(ctx, config, plugin)
    })
}

export interface Config extends ChatLunaPlugin.Config {
    lunar: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        lunar: Schema.boolean().default(false)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-plugin-common'
