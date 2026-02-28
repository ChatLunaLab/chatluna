import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '.'
// import start
import { apply as audio } from './plugins/audio'
import { apply as image } from './plugins/image'
import { apply as readFiles } from './plugins/read_files' // import end

export async function plugins(
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
        [audio, image, readFiles] // middleware end

    for (const middleware of middlewares) {
        await middleware(ctx, config, plugin)
    }
}
