import { Context } from 'koishi'
import EmbeddingsPlugin from '.'
import fs from 'fs/promises'
import VectorStorePlugin from '.'
import { SaveableVectorStore, VectorStore } from 'langchain/vectorstores/base'
import { Document } from 'langchain/document'

export async function vectorstore(ctx: Context, config: VectorStorePlugin.Config, plugin: VectorStorePlugin) {

    const list = await fs.readdir(`${__dirname}/vectorstore`)

    for (const file of list) {
        if (file.endsWith(".d.ts")) {
            continue
        }

        const vectorstrore: {
            apply: (ctx: Context, config: EmbeddingsPlugin.Config, plugin: EmbeddingsPlugin) => PromiseLike<void> | void
        } = await require(`./vectorstore/${file}`)

        if (vectorstrore.apply) {
            await vectorstrore.apply(ctx, config, plugin)
        }
    }
}

