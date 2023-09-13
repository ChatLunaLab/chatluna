import { Context } from 'koishi'
import { ChatHubSaveableVectorStore } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'
import { FaissStore } from 'langchain/vectorstores/faiss'
import path from 'path'
import fs from 'fs/promises'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { Config } from '..'

const logger = createLogger()

export async function apply(ctx: Context, config: Config, plugin: ChatHubPlugin) {
    await plugin.registerVectorStore('faiss', async (params) => {
        const embeddings = params.embeddings
        let faissStore: FaissStore

        const directory = path.join('data/chathub/vector_store/faiss', params.key ?? 'chathub')

        try {
            await fs.access(directory)
        } catch {
            await fs.mkdir(directory, { recursive: true })
        }

        const jsonFile = path.join(directory, 'docstore.json')

        logger.debug(`Loading faiss store from ${directory}`)

        try {
            await fs.access(jsonFile)
            faissStore = await FaissStore.load(directory, embeddings)
        } catch {
            faissStore = await FaissStore.fromTexts(
                ['user:hello', 'your: How can I assist you today?', ' '],
                [''],
                embeddings
            )
        }

        const wrapperStore = new ChatHubSaveableVectorStore(faissStore, (store) =>
            store.save(directory)
        )

        return wrapperStore
    })
}
