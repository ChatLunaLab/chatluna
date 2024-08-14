import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '.'
// import start
import { apply as command } from './plugins/command'
import { apply as cron } from './plugins/cron'
import { apply as draw } from './plugins/draw'
import { apply as fs } from './plugins/fs'
import { apply as group } from './plugins/group'
import { apply as memory } from './plugins/memory'
import { apply as request } from './plugins/request'
import { apply as think } from './plugins/think' // import end

export async function plugin(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    type Plugin = (
        ctx: Context,
        config: Config,
        plugin: ChatLunaPlugin
    ) => PromiseLike<void> | void

    const middlewares: Plugin[] =
        // middleware start
        [command, cron, draw, fs, group, memory, request, think] // middleware end

    for (const middleware of middlewares) {
        await middleware(ctx, config, plugin)
    }
}
