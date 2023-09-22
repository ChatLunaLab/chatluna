import { Context } from 'koishi'
import fs from 'fs/promises'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { Config } from '.'
import path from 'path'

export async function plugin(
    ctx: Context,
    config: Config,
    plugin: ChatHubPlugin
) {
    const list = await fs.readdir(path.join(__dirname, '/plugins'))

    for (const file of list) {
        if (file.endsWith('.d.ts')) {
            continue
        }

        const func: {
            apply: (
                ctx: Context,
                config: Config,
                plugin: ChatHubPlugin
            ) => PromiseLike<void> | void
        } = await require(`./plugins/${file}`)

        if (func.apply) {
            await func.apply(ctx, config, plugin)
        }
    }
}
