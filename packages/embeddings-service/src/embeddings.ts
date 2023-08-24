import { Context } from 'koishi'
import EmbeddingsPlugin from '.'
import fs from 'fs/promises'

export async function embeddings(ctx: Context, config: EmbeddingsPlugin.Config, plugin: EmbeddingsPlugin) {

    const list = await fs.readdir(`${__dirname}/embeddings`)

    for (const file of list) {
        if (file.endsWith(".d.ts")) {
            continue
        }

        const embeddings: {
            apply: (ctx: Context, config: EmbeddingsPlugin.Config, plugin: EmbeddingsPlugin) => PromiseLike<void> | void
        } = await require(`./embeddings/${file}`)

        if (embeddings.apply) {
            await embeddings.apply(ctx, config, plugin)
        }
    }
}