import { Context } from 'koishi'
import fs from 'fs/promises'
import VectorStorePlugin from '.'
import { SaveableVectorStore, VectorStore } from 'langchain/vectorstores/base'
import { Document } from 'langchain/document'

export async function vector_store(ctx: Context, config: VectorStorePlugin.Config, plugin: VectorStorePlugin) {

    const list = await fs.readdir(`${__dirname}/vectorstore`)

    for (const file of list) {
        if (file.endsWith(".d.ts")) {
            continue
        }

        const vector_store: {
            apply: (ctx: Context, config: VectorStorePlugin.Config, plugin: VectorStorePlugin) => PromiseLike<void> | void
        } = await require(`./vectorstore/${file}`)

        if (vector_store.apply) {
            await vector_store.apply(ctx, config, plugin)
        }
    }
}

