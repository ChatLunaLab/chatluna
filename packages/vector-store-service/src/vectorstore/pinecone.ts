import { Context } from 'koishi'
import { Config } from '..'
import { PineconeStore } from 'langchain/vectorstores/pinecone'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { ChatHubSaveableVectorStore } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'

const logger = createLogger()

export function apply(ctx: Context, config: Config, plugin: ChatHubPlugin) {
    plugin.registerVectorStore('pinecone', async (params) => {
        const embeddings = params.embeddings

        const client = new (await importPinecone()).PineconeClient()

        await client.init({
            apiKey: config.pineconeKey,
            environment: config.pineconeRegon
        })

        const pineconeIndex = client.Index(config.pineconeIndex)

        const store = await PineconeStore.fromExistingIndex(embeddings, {
            pineconeIndex,
            namespace: params.key ?? 'chathub'
        })

        const wrapperStore = new ChatHubSaveableVectorStore(store, {
            async deletableFunction(store) {
                return store.delete({
                    deleteAll: true
                })
            }
        })

        return wrapperStore
    })
}

async function importPinecone() {
    try {
        const { PineconeClient } = await import('@pinecone-database/pinecone')

        return { PineconeClient }
    } catch (err) {
        logger.error(err)
        throw new Error(
            'Please install @pinecone-database/pinecone as a dependency with, e.g. `npm install -S @pinecone-database/pinecone`'
        )
    }
}
