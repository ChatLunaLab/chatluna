import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '.'
// import start
import { apply as group } from './plugins/group'
import { apply as lunar } from './plugins/lunar' // import end

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
        [group, lunar] // middleware end

    for (const middleware of middlewares) {
        await middleware(ctx, config, plugin)
    }
}
