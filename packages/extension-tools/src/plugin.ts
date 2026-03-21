import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '.'
// import start
import { apply as command } from './plugins/command'
import { apply as cron } from './plugins/cron'
import { apply as file_sender } from './plugins/file_sender'
import { apply as group } from './plugins/group'
import { apply as music } from './plugins/music'
import { apply as request } from './plugins/request'
import { apply as think } from './plugins/think'
import { apply as todos } from './plugins/todos' // import end

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
        [command, cron, file_sender, group, music, request, think, todos] // middleware end

    for (const middleware of middlewares) {
        await middleware(ctx, config, plugin)
    }
}
