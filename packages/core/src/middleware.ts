import { Context } from 'koishi'
import { Config } from './config'
import fs from 'fs/promises'
import { ChatChain } from './chains/chain'
import path from 'path'

export async function middleware(ctx: Context, config: Config) {
    const list = await fs.readdir(path.join(__dirname, 'middlewares'))

    for (const file of list) {
        if (file.endsWith('.d.ts')) {
            continue
        }

        const middleware: {
            apply: (
                ctx: Context,
                config: Config,
                chain: ChatChain
            ) => PromiseLike<void> | void
        } = await require(`./middlewares/${file}`)

        if (middleware.apply) {
            await middleware.apply(ctx, config, ctx.chathub.chatChain)
        }
    }
}
