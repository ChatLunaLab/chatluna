import { Context, Logger } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { Config } from '..'
import { DataBaseDocstore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { Document } from '@langchain/core/documents'
import { MilvusVectorStore } from './base/milvus'
import { randomUUID } from 'crypto'

let logger: Logger

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    logger = createLogger(ctx, 'chatluna-vector-store-service')

    if (!config.vectorStore.includes('milvus')) {
        return
    }

    const MilvusClass = await importMilvus()

    plugin.registerVectorStore('milvus', async (params) => {
        const embeddings = params.embeddings
        const key = sanitizeMilvusName(params.key ?? 'chatluna')

        const databaseDocstore = new DataBaseDocstore(ctx, key)

        logger.debug(`Loading milvus store with partition: %c`, key)

        const testVector = await embeddings.embedQuery('test')

        if (testVector.length === 0) {
            throw new ChatLunaError(
                ChatLunaErrorCode.VECTOR_STORE_EMBEDDING_DIMENSION_MISMATCH,
                new Error(
                    'Embedding dimension is 0. Try changing the embeddings model.'
                )
            )
        }

        const vectorStore = new MilvusClass(embeddings, {
            collectionName: 'chatluna_collection',
            partitionName: key,
            url: config.milvusUrl,
            autoId: false,
            username: config.milvusUsername,
            password: config.milvusPassword,
            textFieldMaxLength: 3000
        })

        const createCollection = async () => {
            await vectorStore.client.releasePartitions({
                collection_name: 'chatluna_collection',
                partition_names: [key]
            })

            await vectorStore.client.releaseCollection({
                collection_name: 'chatluna_collection'
            })

            await vectorStore.client.dropPartition({
                collection_name: 'chatluna_collection',
                partition_name: key
            })

            let documents: Document[] = [
                new Document({
                    pageContent: 'A',
                    id: randomUUID(),
                    metadata: {
                        raw_id: 'z'.repeat(100),
                        source: 'z'.repeat(100),
                        expirationDate: 'z'.repeat(100),
                        createdAt: 'z'.repeat(100),
                        updateAt: 'z'.repeat(100),
                        time: 'z'.repeat(100),
                        user: 'z'.repeat(100),
                        userId: 'z'.repeat(100),
                        type: 'z'.repeat(100),
                        importance: 0
                    }
                })
            ]

            await vectorStore.ensureCollection([testVector], documents)
            await vectorStore.ensurePartition()

            documents = await databaseDocstore.list()

            await vectorStore.addDocuments(documents)
        }

        try {
            const sampleDoc = new Document({
                pageContent: 'test',
                metadata: {
                    raw_id: 'z'.repeat(100),
                    source: 'z'.repeat(100),
                    expirationDate: 'z'.repeat(100),
                    createdAt: 'z'.repeat(100),
                    updateAt: 'z'.repeat(100),
                    time: 'z'.repeat(100),
                    user: 'z'.repeat(100),
                    userId: 'z'.repeat(100),
                    type: 'z'.repeat(100),
                    importance: 0
                }
            })

            await vectorStore.ensureCollection([testVector], [sampleDoc])
            await vectorStore.ensurePartition()
            await vectorStore.similaritySearchVectorWithScore(testVector, 1)
        } catch (e) {
            logger.warn(
                'Error occurred when initializing milvus collection. Will recreate collection.'
            )
            logger.debug(e)

            try {
                await createCollection()
            } catch (e) {
                logger.error(e)
                throw new ChatLunaError(
                    ChatLunaErrorCode.VECTOR_STORE_INIT_ERROR,
                    new Error('Failed to initialize Milvus collection')
                )
            }
        }

        const wrapperStore = new MilvusVectorStore({
            store: vectorStore,
            docstore: databaseDocstore,
            key,
            createCollection,
            embeddings
        })

        return wrapperStore
    })
}

async function importMilvus() {
    try {
        await import('@zilliz/milvus2-sdk-node')
        const store = await import('@langchain/community/vectorstores/milvus')
        return store.Milvus
    } catch (err) {
        logger?.error(err)
        throw new ChatLunaError(
            ChatLunaErrorCode.VECTOR_STORE_INIT_ERROR,
            new Error(
                'Please install milvus as a dependency with, e.g. `npm install -S @zilliz/milvus2-sdk-node`'
            )
        )
    }
}

function sanitizeMilvusName(name: string) {
    let s = name.replace(/[^A-Za-z0-9_]/g, '_')
    if (!/^[A-Za-z]/.test(s)) s = `p_${s}`
    return s.slice(0, 255)
}
