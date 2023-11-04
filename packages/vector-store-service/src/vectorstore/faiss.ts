import { Context, Logger } from 'koishi'
import { ChatHubSaveableVectorStore } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'
import { FaissStore } from 'langchain/vectorstores/faiss'
import path from 'path'
import fs from 'fs/promises'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { Config } from '..'

let logger: Logger

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatHubPlugin
) {
    logger = createLogger(ctx, 'chathub-vector-store-service')

    await plugin.registerVectorStore('faiss', async (params) => {
        const embeddings = params.embeddings
        let faissStore: FaissStore

        const directory = path.join(
            'data/chathub/vector_store/faiss',
            params.key ?? 'chathub'
        )

        try {
            await fs.access(directory)
        } catch {
            await fs.mkdir(directory, { recursive: true })
        }

        const jsonFile = path.join(directory, 'docstore.json')

        logger.debug(`Loading faiss store from %c`, directory)

        try {
            await fs.access(jsonFile)
            faissStore = await FaissStore.load(directory, embeddings)
        } catch {
            faissStore = await FaissStore.fromTexts(
                ['sample'],
                [' '],
                embeddings
            )
        }

        const wrapperStore = new ChatHubSaveableVectorStore(faissStore, {
            async saveableFunction(store) {
                store.save(directory)
            },
            async deletableFunction(store) {
                await fs.rm(directory, { recursive: true })
            }
        })

        return wrapperStore
    })
}
