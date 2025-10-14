import { Context, Logger } from 'koishi'
import { FaissStore } from '@langchain/community/vectorstores/faiss'
import path from 'path'
import fs from 'fs/promises'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { DataBaseDocstore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { checkFileExists } from '../utils'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { Document } from '@langchain/core/documents'
import { FaissVectorStore } from './base/faiss'
import { randomUUID } from 'crypto'

let logger: Logger

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    logger = createLogger(ctx, 'chatluna-vector-store-service')

    if (!config.vectorStore.includes('faiss')) {
        return
    }

    await FaissStore.importFaiss()

    plugin.registerVectorStore('faiss', async (params) => {
        const embeddings = params.embeddings
        const key = params.key ?? 'chatluna'
        const directory = path.join(
            ctx.baseDir,
            'data/chathub/vector_store/faiss',
            key
        )

        let faissStore: FaissStore

        try {
            await fs.access(directory)
        } catch {
            await fs.mkdir(directory, { recursive: true })
        }

        const jsonFile = path.join(directory, 'docstore.json')
        const databaseDocstore = new DataBaseDocstore(ctx, key)

        logger.debug(`Loading faiss store from %c`, directory)

        const testVector = await embeddings.embedQuery('test')

        if (testVector.length === 0) {
            throw new ChatLunaError(
                ChatLunaErrorCode.VECTOR_STORE_EMBEDDING_DIMENSION_MISMATCH,
                new Error(
                    'Embedding dimension is 0. Try changing the embeddings model.'
                )
            )
        }

        const reIndexFaissStore = async () => {
            let documents = await databaseDocstore.list()

            if (documents.length === 0) {
                documents = [
                    new Document({
                        pageContent: 'A',
                        id: randomUUID()
                    })
                ]
            }

            logger.info(
                `ReIndex faiss store with %c documents`,
                documents.length
            )

            faissStore = await FaissStore.fromDocuments(documents, embeddings)

            await faissStore.save(directory)
        }

        if (await checkFileExists(jsonFile)) {
            faissStore = await FaissStore.load(directory, embeddings)
        } else {
            await reIndexFaissStore()
        }

        if (testVector.length !== faissStore.index.getDimension()) {
            logger.warn(
                `Embeddings dimension mismatch: (Embedding) ${testVector.length} !== (FaissVector) ${faissStore.index.getDimension()}.
                The faiss store will reindex the documents.`
            )
            await reIndexFaissStore()
        }

        const wrapperStore = new FaissVectorStore({
            store: faissStore,
            docstore: databaseDocstore,
            directory,
            embeddings
        })

        return wrapperStore
    })
}
