import { Context } from 'koishi';
import { Config } from './config';
import fs from 'fs/promises';
import { ChatChain } from './chains/chain';


export async function command(ctx: Context, config: Config) {

    const list = await fs.readdir(`${__dirname}/commands`)

    for (const file of list) {
        if (file.endsWith(".d.ts")) {
            continue
        }

        const command: {
            apply: (ctx: Context, config: Config, chain: ChatChain) => PromiseLike<void> | void
        } = await require(`./commands/${file}`)

        if (command.apply) {
            await command.apply(ctx, config, ctx.chathub.chatChain)
        }
    }
}