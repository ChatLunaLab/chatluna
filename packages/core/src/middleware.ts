import fs from 'fs/promises'
import { Context } from 'koishi'
import path from 'path'
import { ChatChain } from './chains/chain'
import { Config } from './config'

export async function middleware(ctx: Context, config: Config) {
    const list = await fs.readdir(path.join(__dirname, 'middlewares'))

    for (let file of list) {
        if (file.endsWith('.d.ts')) {
            file = file.slice(0, -5) + '.ts'
        }

        const middleware: {
            apply: (
                ctx: Context,
                config: Config,
                chain: ChatChain
            ) => PromiseLike<void> | void
        } = await import(`./middlewares/${file}`)

        if (middleware.apply) {
            await middleware.apply(ctx, config, ctx.chatluna.chatChain)
        }
    }
}
