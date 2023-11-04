import { Context, Logger } from 'koishi'
import { LanceDB } from 'langchain/vectorstores/lancedb'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import type { Table } from 'vectordb'
import path from 'path'
import fs from 'fs/promises'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { Config } from '..'
import { ChatHubSaveableVectorStore } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'

let logger: Logger

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatHubPlugin
) {
    logger = createLogger(ctx, 'chathub-vector-store-service')

    await plugin.registerVectorStore('lancedb', async (params) => {
        const embeddings = params.embeddings

        const directory = path.join(
            'data/chathub/vector_store/lancedb',
            params.key ?? 'chathub'
        )

        try {
            await fs.access(directory)
        } catch {
            await fs.mkdir(directory, { recursive: true })
        }

        logger.debug(`Loading lancedb from %c`, directory)

        const client = await (await importLanceDB()).connect(directory)

        const tableNames = await client.tableNames()

        let table: Table<number[]>

        if (tableNames.some((text) => text === 'vectors')) {
            table = await client.openTable('')
        } else {
            table = await client.createTable('vectors', [
                { vector: Array(config.vectorSize), text: 'sample' }
            ])
        }

        const store = await LanceDB.fromTexts(['sample'], [' '], embeddings, {
            table
        })

        const wrapperStore = new ChatHubSaveableVectorStore(store, {
            async deletableFunction(store) {
                await client.dropTable('vectors')
                await fs.rm(directory, { recursive: true })
            }
        })

        return wrapperStore
    })
}

async function importLanceDB() {
    try {
        const any = await import('vectordb')

        return any
    } catch (err) {
        logger.error(err)
        throw new Error(
            'Please install vectordb as a dependency with, e.g. `npm install -S vectordb`'
        )
    }
}
