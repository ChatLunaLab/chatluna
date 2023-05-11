import { Context } from 'koishi';
import { Config } from './config';
import fs from 'fs/promises';
import { getChatChain } from './index'
import { ChatChain } from './chain';

export async function middleware(ctx: Context, config: Config) {

    const list = await fs.readdir(`${__dirname}/middlewares`)

    for (const file of list) {
        if (file.endsWith(".d.ts")) { 
            continue
        }

        const middleware: {
            apply: (ctx: Context, config: Config, chain: ChatChain) => PromiseLike<void> | void
        } = await require(`./middlewares/${file}`)

        if (middleware.apply) {
            await middleware.apply(ctx, config, getChatChain())
        }
    }
}