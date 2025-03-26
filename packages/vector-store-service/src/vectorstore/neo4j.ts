import { Context, Logger } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { Config } from '..'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/model/base'
import type { Neo4jVectorStore } from '@langchain/community/vectorstores/neo4j_vector'

let logger: Logger

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    logger = createLogger(ctx, 'chatluna-vector-store-service')

    if (!config.vectorStore.includes('neo4j')) {
        return
    }

    const { Neo4jVectorStoreInstace, neo4j } = await importNeo4j()

    plugin.registerVectorStore('neo4j', async (params) => {
        const embeddings = params.embeddings

        const testVector = await embeddings.embedQuery('test')

        if (testVector.length === 0) {
            throw new Error(
                'Embedding dimension is 0, Try to change the embeddings model.'
            )
        }

        // Neo4j connection config following the documentation pattern
        const vectorStoreConfig = {
            url: config.neo4jUrl,
            username: config.neo4jUsername,
            password: config.neo4jPassword,
            indexName: params.key ?? 'chatluna',
            nodeLabel: 'Embedding',
            textNodeProperty: 'text',
            embeddingNodeProperty: 'embedding',
            searchType: 'vector' as const // Support for hybrid search if needed
        }

        // Create a direct driver connection for our operations
        let driver: ReturnType<typeof import('neo4j-driver').driver>
        try {
            driver = neo4j.driver(
                vectorStoreConfig.url,
                neo4j.auth.basic(
                    vectorStoreConfig.username,
                    vectorStoreConfig.password
                )
            )
        } catch (err) {
            logger.error('Failed to create Neo4j driver', err)
            throw err
        }

        // Use the standard Neo4jVectorStore creation
        // This will handle database initialization properly
        try {
            // Check if index exists first
            let vectorStore: Neo4jVectorStore
            try {
                // Try to connect to existing index
                vectorStore = await Neo4jVectorStoreInstace.fromExistingIndex(
                    embeddings,
                    vectorStoreConfig
                )
                logger.debug(
                    `Connected to existing Neo4j index: ${vectorStoreConfig.indexName}`
                )
            } catch (error) {
                // If that fails, we'll create a new empty store
                logger.debug(
                    `Creating new Neo4j index: ${vectorStoreConfig.indexName}`
                )
                vectorStore = new Neo4jVectorStoreInstace(
                    embeddings,
                    vectorStoreConfig
                )
                // Initialize index if needed
                await vectorStore.createNewIndex()
            }

            logger.debug(
                `Neo4j vector store ready with index ${params.key ?? 'chatluna'}`
            )

            const wrapperStore =
                new ChatLunaSaveableVectorStore<Neo4jVectorStore>(vectorStore, {
                    async deletableFunction(_store, options) {
                        if (options.deleteAll) {
                            // Use our own driver connection
                            const session = driver.session()
                            try {
                                await session.run(
                                    `MATCH (n:${vectorStoreConfig.nodeLabel} {indexName: $indexName}) DETACH DELETE n`,
                                    { indexName: vectorStoreConfig.indexName }
                                )
                            } finally {
                                await session.close()
                            }
                            return
                        }

                        const ids: string[] = []
                        if (options.ids) {
                            ids.push(...options.ids)
                        }

                        if (options.documents) {
                            const documentIds = options.documents
                                ?.map((document) => {
                                    return document.metadata?.raw_id as
                                        | string
                                        | undefined
                                })
                                .filter((id): id is string => id != null)

                            ids.push(...documentIds)
                        }

                        if (ids.length < 1) {
                            return
                        }

                        // Delete specific nodes by id
                        const session = driver.session()
                        try {
                            await session.run(
                                `MATCH (n:${vectorStoreConfig.nodeLabel} {indexName: $indexName})
                                WHERE n.id IN $ids
                                DETACH DELETE n`,
                                { indexName: vectorStoreConfig.indexName, ids }
                            )
                        } finally {
                            await session.close()
                        }
                    },
                    async addDocumentsFunction(store, documents) {
                        // Process document IDs and metadata
                        const processedDocuments = documents.map((document) => {
                            const id = crypto.randomUUID()
                            document.metadata = {
                                ...document.metadata,
                                raw_id: id
                            }
                            return document
                        })

                        // Use the standard addDocuments method from Neo4jVectorStore
                        await store.addDocuments(processedDocuments)
                    },
                    async freeFunction() {
                        // Close the store's internal connection through vectorStore
                        await vectorStore.close()
                        // Close our own driver connection
                        if (driver) {
                            await driver.close()
                        }
                    },
                    async saveableFunction() {
                        // No special saving required for Neo4j
                    }
                })

            return wrapperStore
        } catch (error) {
            logger.error('Error initializing Neo4j vector store', error)
            throw error
        }
    })
}

async function importNeo4j() {
    try {
        try {
            // Try to import Neo4jVectorStore from the correct location
            const { Neo4jVectorStore } = await import(
                '@langchain/community/vectorstores/neo4j_vector'
            )
            return {
                neo4j: await import('neo4j-driver'),
                Neo4jVectorStoreInstace: Neo4jVectorStore
            }
        } catch (err) {
            logger.warn(
                'Failed to import Neo4jVectorStore from @langchain/community, trying alternate sources'
            )
            throw err
        }
    } catch (err) {
        logger.error(err)
        throw new Error(
            'Please install neo4j-driver and @langchain/community as dependencies with, e.g. `npm install -S neo4j-driver @langchain/community`'
        )
    }
}
