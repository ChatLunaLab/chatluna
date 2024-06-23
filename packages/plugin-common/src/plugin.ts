import fs from 'fs/promises'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import path from 'path'
import { Config } from '.'
import { fileURLToPath } from 'url'

export async function plugin(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    const dirname =
        __dirname?.length > 0 ? __dirname : fileURLToPath(import.meta.url)
    const list = await fs.readdir(path.join(dirname, '/plugins'))

    for (const file of list) {
        if (file.endsWith('.d.ts')) {
            continue
        }

        const func: {
            apply: (
                ctx: Context,
                config: Config,
                plugin: ChatLunaPlugin
            ) => PromiseLike<void> | void
        } = await import(`./plugins/${file}`)

        if (func.apply) {
            await func.apply(ctx, config, plugin)
        }
    }
}
