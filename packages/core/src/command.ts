import fs from 'fs/promises'
import { Context } from 'koishi'
import path from 'path'
import { fileURLToPath } from 'url'
import { ChatChain } from './chains'
import { Config } from './config'

export async function command(ctx: Context, config: Config) {
    const dirname =
        __dirname?.length > 0 ? __dirname : fileURLToPath(import.meta.url)
    const list = await fs.readdir(path.join(dirname, 'commands'))

    for (let file of list) {
        if (file.endsWith('.d.ts')) {
            file = file.slice(0, -5) + '.ts'
        }

        const command: {
            apply: (
                ctx: Context,
                config: Config,
                chain: ChatChain
            ) => PromiseLike<void> | void
        } = await import(`./commands/${file}`)

        if (command.apply) {
            await command.apply(ctx, config, ctx.chatluna.chatChain)
        }
    }
}
