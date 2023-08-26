import { Context } from 'koishi'
import fs from 'fs/promises'
import { SaveableVectorStore, VectorStore } from 'langchain/vectorstores/base'
import { Document } from 'langchain/document'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { Config } from '.'

export async function vector_store(ctx: Context, config: Config, plugin: ChatHubPlugin) {

    const list = await fs.readdir(`${__dirname}/vectorstore`)

    for (const file of list) {
        if (file.endsWith(".d.ts")) {
            continue
        }

        const vector_store: {
            apply: (ctx: Context, config: Config, plugin: ChatHubPlugin) => PromiseLike<void> | void
        } = await require(`./vectorstore/${file}`)

        if (vector_store.apply) {
            await vector_store.apply(ctx, config, plugin)
        }
    }
}

