import { Context, Logger } from 'koishi'
import { RedisVectorStore } from '@langchain/redis'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { DataBaseDocstore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { Document } from '@langchain/core/documents'
import { RedisVectorStoreWrapper } from './base/redis'
import { randomUUID } from 'crypto'

let logger: Logger

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    logger = createLogger(ctx, 'chatluna-vector-store-service')

    if (!config.vectorStore.includes('redis')) {
        return
    }

    await importRedis()

    plugin.registerVectorStore('redis', async (params) => {
        const embeddings = params.embeddings
        const key = params.key ?? 'chatluna'

        const client = await createClient(config.redisUrl)
        await client.connect()

        const databaseDocstore = new DataBaseDocstore(ctx, key)

        logger.debug(`Loading redis store with index: %c`, key)

        const testVector = await embeddings.embedQuery('test')

        if (testVector.length === 0) {
            throw new ChatLunaError(
                ChatLunaErrorCode.VECTOR_STORE_EMBEDDING_DIMENSION_MISMATCH,
                new Error(
                    'Embedding dimension is 0. Try changing the embeddings model.'
                )
            )
        }

        const vectorStore = new RedisVectorStore(embeddings, {
            redisClient: client,
            indexName: key
        })

        const reInitializeRedisStore = async () => {
            let documents = await databaseDocstore.list()

            if (documents.length === 0) {
                documents = [
                    new Document({
                        pageContent: 'A',
                        id: randomUUID()
                    })
                ]
            }

            try {
                await vectorStore.dropIndex(true)
            } catch (e) {}

            await vectorStore.createIndex(testVector.length)

            const tempIds = documents.map(
                (document) => document.id ?? randomUUID()
            )
            await vectorStore.addDocuments(documents, {
                keys: tempIds.map((id) => vectorStore.keyPrefix + id)
            })
        }

        try {
            await vectorStore.createIndex(testVector.length)
        } catch (e) {
            logger.warn(
                'Error occurred when creating redis index. Will drop and recreate index.'
            )
            logger.debug(e)

            await reInitializeRedisStore()
        }

        try {
            await vectorStore.similaritySearchVectorWithScore(testVector, 1)
        } catch (e) {
            logger.warn(
                'Error occurred when querying redis index. Will drop and recreate index.'
            )
            logger.debug(e)

            await reInitializeRedisStore()
        }

        const wrapperStore = new RedisVectorStoreWrapper({
            store: vectorStore,
            docstore: databaseDocstore,
            client,
            embeddings
        })

        return wrapperStore
    })
}

async function createClient(url: string) {
    const redis = await importRedis()
    return redis.createClient({ url })
}

async function importRedis() {
    try {
        return await import('redis')
    } catch (err) {
        logger?.error(err)
        throw new ChatLunaError(
            ChatLunaErrorCode.VECTOR_STORE_INIT_ERROR,
            new Error(
                'Please install redis as a dependency with, e.g. `npm install -S redis`'
            )
        )
    }
}
