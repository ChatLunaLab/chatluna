import { Context, Logger } from 'koishi'
import { LunaVDB as LunaDB } from '@chatluna/luna-vdb'
import path from 'path'
import fs from 'fs/promises'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { randomUUID } from 'crypto'
import { DataBaseDocstore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { checkFileExists } from '../utils'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { Document } from '@langchain/core/documents'
import { LunaDBVectorStore, LunaVectorStore } from './base/lunavdb'

let logger: Logger

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    logger = createLogger(ctx, 'chatluna-vector-store-service')

    if (!config.vectorStore.includes('luna-vdb')) {
        return
    }

    plugin.registerVectorStore('luna-vdb', async (params) => {
        const embeddings = params.embeddings
        const key = params.key ?? 'chatluna'
        const directory = path.join(
            ctx.baseDir,
            'data/chathub/vector_store/luna_vdb',
            key
        )

        let tempStore: LunaDBVectorStore

        try {
            await fs.access(directory)
        } catch {
            await fs.mkdir(directory, { recursive: true })
        }

        const jsonFile = path.join(directory, 'docstore.json')
        const databaseDocstore = new DataBaseDocstore(ctx, key)

        logger.debug(`Loading luna vdb store from %c`, directory)

        const testVector = await embeddings.embedQuery('test')

        if (testVector.length === 0) {
            throw new ChatLunaError(
                ChatLunaErrorCode.VECTOR_STORE_EMBEDDING_DIMENSION_MISMATCH,
                new Error(
                    'Embedding dimension is 0, Try to change the embeddings model.'
                )
            )
        }

        const reIndexLunaDBStore = async () => {
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
                `ReIndex lunavdb store with %c documents`,
                documents.length
            )

            const lunaDBStore = new LunaDB()
            tempStore = new LunaDBVectorStore(lunaDBStore, embeddings)
            await tempStore.addDocuments(documents)
            await tempStore.save(directory)
        }

        if (await checkFileExists(jsonFile)) {
            tempStore = await LunaDBVectorStore.load(directory, embeddings)

            try {
                await tempStore.similaritySearchVectorWithScore(testVector, 1)
            } catch (e) {
                logger.warn(
                    `Embeddings dimension or index issue detected. The luna vdb store will reindex the documents.`,
                    e
                )
                await reIndexLunaDBStore()
            }
        } else {
            await reIndexLunaDBStore()
        }

        const wrapperStore = new LunaVectorStore({
            store: tempStore,
            docstore: databaseDocstore,
            directory,
            embeddings
        })

        return wrapperStore
    })
}
