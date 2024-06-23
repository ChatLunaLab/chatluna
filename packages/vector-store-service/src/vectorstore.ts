import fs from 'fs/promises'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import path from 'path'
import { Config } from '.'
import { fileURLToPath } from 'url'

export async function vectorStore(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    const dirname =
        __dirname?.length > 0 ? __dirname : fileURLToPath(import.meta.url)
    const list = await fs.readdir(path.join(dirname, 'vectorstore'))

    for (let file of list) {
        if (!file.endsWith('.d.ts')) {
            continue
        }

        file = file.slice(0, -5)

        const vectorStore: {
            apply: (
                ctx: Context,
                config: Config,
                plugin: ChatLunaPlugin
            ) => PromiseLike<void> | void
        } = await import(
            `koishi-plugin-chatluna-vector-store-service/vectorstore/${file}`
        )

        if (vectorStore.apply) {
            await vectorStore.apply(ctx, config, plugin)
        }
    }
}
