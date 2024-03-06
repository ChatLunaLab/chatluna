import { Context } from 'koishi'
import fs from 'fs/promises'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/lib/services/chat'
import { Config } from '.'
import path from 'path'

export async function vectorStore(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    const list = await fs.readdir(path.join(__dirname, 'vectorstore'))

    for (const file of list) {
        if (file.endsWith('.d.ts')) {
            continue
        }

        const vectorStore: {
            apply: (
                ctx: Context,
                config: Config,
                plugin: ChatLunaPlugin
            ) => PromiseLike<void> | void
        } = await require(`./vectorstore/${file}`)

        if (vectorStore.apply) {
            await vectorStore.apply(ctx, config, plugin)
        }
    }
}
