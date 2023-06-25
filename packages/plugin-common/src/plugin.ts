import { Context } from 'koishi'
import fs from 'fs/promises'
import { SaveableVectorStore, VectorStore } from 'langchain/vectorstores/base'
import { Document } from 'langchain/document'
import CommonPlugin from '.'

export async function plugin(ctx: Context, config: CommonPlugin.Config, plugin: CommonPlugin) {

    const list = await fs.readdir(`${__dirname}/plugins`)

    for (const file of list) {
        if (file.endsWith(".d.ts")) {
            continue
        }

        const vectorstrore: {
            apply: (ctx: Context, config: CommonPlugin.Config, plugin: CommonPlugin) => PromiseLike<void> | void
        } = await require(`./plugins/${file}`)

        if (vectorstrore.apply) {
            await vectorstrore.apply(ctx, config, plugin)
        }
    }
}

