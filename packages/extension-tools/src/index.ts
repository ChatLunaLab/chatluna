/* eslint-disable max-len */
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Context, Logger } from 'koishi'
import { plugin as plugins } from './plugin'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { Config } from './config'

export let logger: Logger
export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(ctx, config, 'plugin-common', false)
    logger = createLogger(ctx, 'chatluna-plugin-common')

    ctx.on('ready', async () => {
        await plugins(ctx, config, plugin)
    })
}

export * from './config'
