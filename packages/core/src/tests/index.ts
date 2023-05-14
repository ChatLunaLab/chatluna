import { Context } from 'koishi';
import { Config } from '../config';
import fs from 'fs/promises';


export async function test(ctx: Context, config: Config) {

    const list = await fs.readdir(`${__dirname}`)

    for (const file of list) {
        if (file.endsWith(".d.ts") || file.includes('index')) {
            continue
        }

        const command: {
            apply: (ctx: Context, config: Config) => PromiseLike<void> | void
        } = await require(`./${file}`)

        if (command.apply) {
            await command.apply(ctx, config)
        }
    }
}