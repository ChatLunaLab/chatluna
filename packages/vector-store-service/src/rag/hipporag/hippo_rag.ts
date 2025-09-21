/* eslint-disable max-len */
import { Context } from 'koishi'
import { Document } from '@langchain/core/documents'
import { Embeddings } from '@langchain/core/embeddings'
import { ChatLunaGraph, GraphEdge, GraphNode } from '../graph'
import { defineHippoRAGConfig, HippoRAGConfig } from './config'
import { OpenIE } from './information_extraction/openie'
import { DSPyFilter } from './rerank'
import * as path from 'path'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import {
    computeMDHashId,
    extractEntityNodes,
    flattenFacts,
    OpenIEDocument,
    QuerySolution,
    reformatOpenIEResults,
    textProcessing,
    Triple
} from './utils'

/**
 * HippoRAG Implementation
 *
 * This class implements the HippoRAG framework for knowledge graph-based retrieval.
 * The system works by:
 *
 * 1. **Document Indexing Phase:**
 *    - Extract entities and relations from documents using OpenIE
 *    - Build a knowledge graph connecting entities through relations
 *    - Create separate embedding stores for chunks, entities, and facts
 *    - Add synonymy edges between similar entities
 *
 * 2. **Retrieval Phase:**
 *    - Retrieve relevant facts using embedding similarity
 *    - Rerank facts using LLM for recognition memory
 *    - Perform graph search with Personalized PageRank
 *    - Return ranked documents based on graph scores
 *
 * Key Components:
 * - **Knowledge Graph**: Built from extracted triples, stored using SelfGraph
 * - **Embedding Stores**: Separate stores for chunks, entities, and facts
 * - **OpenIE Processing**: Extract structured knowledge from text
 * - **Graph Search**: Use PPR for retrieval with fact-based node weights
 *
 * Performance Features:
 * - Batch processing for embeddings
 * - Incremental graph updates
 * - Caching for repeated queries
 * - Efficient graph serialization
 */
export class HippoRAG {
    private globalConfig: HippoRAGConfig

    private llmModel: ChatLunaChatModel

    private openie: OpenIE

    private graph: ChatLunaGraph

    private embeddingModel: Embeddings
    public chunkEmbeddingStore: ChatLunaSaveableVectorStore
    private entityEmbeddingStore: ChatLunaSaveableVectorStore
    private factEmbeddingStore: ChatLunaSaveableVectorStore

    private rerankFilter: DSPyFilter

    private readyToRetrieve = false

    private pprTime = 0

    private allRetrievalTime = 0
    private entNodeToChunkIds?: Map<string, Set<string>>
    private nodeToNodeStats: Map<string, number> = new Map()
    private _graphPickleFilename: string
    private queryToEmbedding: {
        triple: Map<string, number[]>
        passage: Map<string, number[]>
    } = {
        triple: new Map(),
        passage: new Map()
    }

    private entityNodeKeys: string[] = []
    private passageNodeKeys: string[] = []
    private factNodeKeys: string[] = []
    private nodeNameToVertexIdx: Map<string, number> = new Map()
    private entityNodeIdxs: number[] = []
    private passageNodeIdxs: number[] = []
    private procTriplesToDocs: Map<string, Set<string>> = new Map()

    private workingDir: string

    constructor(
        private ctx: Context,
        globalConfig: HippoRAGConfig
    ) {
        // Initialize configuration

        this.globalConfig = defineHippoRAGConfig(globalConfig)

        this.llmModel = globalConfig.llm

        // Setup working directory
        this.workingDir = globalConfig.saveDir
        // Initialize graph
        this.embeddingModel = this.globalConfig.embeddings

        this.graph = this.initializeGraph()

        this.openie = new OpenIE(this.workingDir, this.llmModel)

        // Initialize rerank filter for fact reranking
        this.rerankFilter = new DSPyFilter(this.llmModel, {
            maxCompletionTokens: 512,
            model: globalConfig.llm.name
        })
    }

    /**
     * Initializes a graph using a JSON file if available or creates a new graph.
     */
    initializeGraph(): ChatLunaGraph {
        this._graphPickleFilename = path.join(this.workingDir, 'graph.json')

        const preloadedGraph: ChatLunaGraph | null = null

        if (preloadedGraph === null) {
            return new ChatLunaGraph(this.globalConfig.isDirectedGraph)
        } else {
            return preloadedGraph
        }
    }

    async initialize() {
        if (
            !this.chunkEmbeddingStore ||
            !this.chunkEmbeddingStore.checkActive(false)
        ) {
            this.chunkEmbeddingStore =
                await this.ctx.chatluna.platform.createVectorStore(
                    this.ctx.chatluna.config.defaultVectorStore,
                    {
                        embeddings: this.embeddingModel,
                        key: this.globalConfig.key + '_chunk_embeddings'
                    }
                )
        }

        if (
            !this.entityEmbeddingStore ||
            !this.entityEmbeddingStore.checkActive(false)
        ) {
            this.entityEmbeddingStore =
                await this.ctx.chatluna.platform.createVectorStore(
                    this.ctx.chatluna.config.defaultVectorStore,
                    {
                        embeddings: this.embeddingModel,
                        key: this.globalConfig.key + '_entity_embeddings'
                    }
                )
        }

        if (
            !this.factEmbeddingStore ||
            !this.factEmbeddingStore.checkActive(false)
        ) {
            this.factEmbeddingStore =
                await this.ctx.chatluna.platform.createVectorStore(
                    this.ctx.chatluna.config.defaultVectorStore,
                    {
                        embeddings: this.embeddingModel,
                        key: this.globalConfig.key + '_fact_embeddings'
                    }
                )
        }
    }

    /**
     * Indexes the given documents based on the HippoRAG framework
     */
    async index(docs: Document[]): Promise<void> {
        this.ctx.logger.success(`Indexing ${docs.length} documents...`)

        // Ensure all vector stores are properly initialized before proceeding
        try {
            this.ctx.logger.success('Initializing vector stores...')
            await this.initialize()
            this.ctx.logger.success('Vector stores initialized successfully')
        } catch (error) {
            this.ctx.logger.error(
                `Failed to initialize vector stores: ${error}`
            )
            throw new Error(`Store initialization failed: ${error}`)
        }

        this.ctx.logger.success('Performing OpenIE')

        // Insert documents into chunk embedding store
        await this.insertStringsToChunkStore(docs)

        const chunks = await this.chunkEmbeddingStore.docstore
            .list()
            .then((docs) =>
                Object.fromEntries(docs.map((doc) => [doc.id, doc]))
            )

        const chunkIds = Object.keys(chunks)

        // Load existing OpenIE results and determine which chunks need processing
        const [, reProcessChunkKeys] = await this.loadExistingOpenIE(chunkIds)

        const newOpenIEs: Record<string, { content: string }> = {}
        for (const key of reProcessChunkKeys) {
            newOpenIEs[key] = { content: chunks[key].pageContent }
        }

        // Process new chunks with OpenIE if any
        if (reProcessChunkKeys.size > 0) {
            const [newNerResultsDict, newTripleResultsDict] =
                await this.openie.batchOpenIE(newOpenIEs)
            this.openie.mergeDocuments(
                newOpenIEs,
                newNerResultsDict,
                newTripleResultsDict
            )
        }

        // Save OpenIE results
        await this.openie.save()

        const allOpenIEInfos = this.openie.getAll()
        // Reformat OpenIE results for processing
        const { nerResultsDict, tripleResultsDict } =
            reformatOpenIEResults(allOpenIEInfos)

        // Verify data consistency
        if (
            chunkIds.length !== Object.keys(nerResultsDict).length ||
            chunkIds.length !== Object.keys(tripleResultsDict).length
        ) {
            throw new Error(
                `Data length mismatch: chunks=${chunkIds.length}, ner=${Object.keys(nerResultsDict).length}, triples=${Object.keys(tripleResultsDict).length}`
            )
        }

        // Process triples and extract entities
        const chunkTriples = chunkIds.map(
            (chunkId) =>
                tripleResultsDict[chunkId]?.triples?.map((t) =>
                    textProcessing(t)
                ) || []
        )
        const { entityNodes, chunkTripleEntities } =
            extractEntityNodes(chunkTriples)
        const facts = flattenFacts(chunkTriples)

        this.ctx.logger.success(`Encoding ${entityNodes.length} Entities`)
        await this.insertStringsToEntityStore(entityNodes)

        this.ctx.logger.success(`Encoding ${facts.length} Facts`)
        await this.insertStringsToFactStore(
            facts.map((fact) => JSON.stringify(fact))
        )

        this.ctx.logger.success('Constructing Graph')

        this.nodeToNodeStats = new Map()
        this.entNodeToChunkIds = new Map()

        this.addFactEdges(chunkIds, chunkTriples)
        const numNewChunks = this.addPassageEdges(chunkIds, chunkTripleEntities)

        if (numNewChunks > 0) {
            this.ctx.logger.success(
                `Found ${numNewChunks} new chunks to save into graph.`
            )
            await this.addSynonymyEdges()
            await this.augmentGraph()
            await this.saveGraph()
        }
    }

    private normalizeDocIdsToChunkIds(docIds: string[]): Set<string> {
        const chunkIdsToDelete = new Set<string>()

        for (const docId of docIds) {
            const chunkId = docId.startsWith('chunk-')
                ? docId
                : computeMDHashId(docId, 'chunk-')
            chunkIdsToDelete.add(chunkId)
        }

        return chunkIdsToDelete
    }

    private async collectOpenIERemovals(
        chunkIdsToDelete: Set<string>
    ): Promise<{
        entitiesToRemove: Set<string>
        factsToRemove: Set<string>
        docsToKeep: OpenIEDocument[]
    }> {
        const entitiesToRemove = new Set<string>()
        const factsToRemove = new Set<string>()
        const docsToKeep: OpenIEDocument[] = []

        if (await this.openie.exists()) {
            const allOpenieInfo = await this.openie.load()

            for (const openieInfo of allOpenieInfo) {
                const normalizedIdx = computeMDHashId(
                    openieInfo.passage,
                    'chunk-'
                )

                if (chunkIdsToDelete.has(normalizedIdx)) {
                    if (openieInfo.extractedTriples) {
                        const triples = flattenFacts([
                            openieInfo.extractedTriples
                        ])
                        for (const triple of triples) {
                            if (triple.length === 3) {
                                const processedTriple = textProcessing(triple)
                                const [subject, , object] = processedTriple

                                entitiesToRemove.add(
                                    computeMDHashId(subject, 'entity-')
                                )
                                entitiesToRemove.add(
                                    computeMDHashId(object, 'entity-')
                                )

                                factsToRemove.add(
                                    computeMDHashId(
                                        JSON.stringify(processedTriple),
                                        'fact-'
                                    )
                                )
                            }
                        }
                    }
                } else {
                    docsToKeep.push(openieInfo)
                }
            }

            this.openie.setDocuments(docsToKeep)
            await this.openie.save()
        }

        return { entitiesToRemove, factsToRemove, docsToKeep }
    }

    private async removeChunksFromStore(docIds: string[]): Promise<void> {
        try {
            await this.chunkEmbeddingStore.delete({
                ids: docIds
            })

            this.ctx.logger.success(
                `Removed ${docIds.length} chunks from chunk store`
            )
        } catch (error) {
            this.ctx.logger.error(`Error removing chunks: ${error}`)
        }
    }

    private async removeEntitiesFromStore(entityIds: string[]): Promise<void> {
        if (entityIds.length === 0) return

        try {
            await this.entityEmbeddingStore.delete({
                ids: entityIds
            })

            this.ctx.logger.success(
                `Removed ${entityIds.length} orphaned entities from entity store`
            )
        } catch (error) {
            this.ctx.logger.error(`Error removing entities: ${error}`)
        }
    }

    private async removeFactsFromStore(factIds: string[]): Promise<void> {
        if (factIds.length === 0) return

        try {
            await this.factEmbeddingStore.delete({
                ids: factIds
            })

            this.ctx.logger.success(
                `Removed ${factIds.length} orphaned facts from fact store`
            )
        } catch (error) {
            this.ctx.logger.error(`Error removing facts: ${error}`)
        }
    }

    private async computeRemainingRefsAndOrphans(
        docsToKeep: OpenIEDocument[],
        entitiesToRemove: Set<string>,
        factsToRemove: Set<string>
    ): Promise<{
        orphanedEntities: Set<string>
        orphanedFacts: Set<string>
    }> {
        const remainingEntityRefs = new Set<string>()
        const remainingFactRefs = new Set<string>()

        if (await this.openie.exists()) {
            const remainingOpenieInfo = await this.openie.load()
            for (const openieInfo of remainingOpenieInfo) {
                if (openieInfo.extractedTriples) {
                    const triples = flattenFacts([openieInfo.extractedTriples])
                    for (const triple of triples) {
                        const normalizedTriple = textProcessing(triple)
                        if (triple.length === 3) {
                            const [subject, , object] = normalizedTriple
                            remainingEntityRefs.add(
                                computeMDHashId(subject, 'entity-')
                            )
                            remainingEntityRefs.add(
                                computeMDHashId(object, 'entity-')
                            )
                        }
                        remainingFactRefs.add(
                            computeMDHashId(
                                JSON.stringify(normalizedTriple),
                                'fact-'
                            )
                        )
                    }
                }
            }
        }

        const orphanedEntities = new Set<string>()
        for (const entityId of entitiesToRemove) {
            if (!remainingEntityRefs.has(entityId)) {
                orphanedEntities.add(entityId)
            }
        }

        const orphanedFacts = new Set<string>()
        for (const factId of factsToRemove) {
            if (!remainingFactRefs.has(factId)) {
                orphanedFacts.add(factId)
            }
        }

        return { orphanedEntities, orphanedFacts }
    }

    private async updateGraphAndMappings(
        nodeIdsToDelete: string[],
        chunkIdsToDelete: Set<string>,
        orphanedEntities: Set<string>,
        orphanedFacts?: Set<string>
    ): Promise<void> {
        const allNodeIdsToDelete: string[] = []

        // Add provided nodeIdsToDelete
        for (const nodeId of nodeIdsToDelete) {
            if (this.graph.hasNode(nodeId)) {
                allNodeIdsToDelete.push(nodeId)
            }
        }

        // Add chunk nodes
        for (const chunkId of chunkIdsToDelete) {
            if (this.graph.hasNode(chunkId)) {
                allNodeIdsToDelete.push(chunkId)
            }
        }

        // Add orphaned entity nodes
        for (const entityId of orphanedEntities) {
            if (this.graph.hasNode(entityId)) {
                allNodeIdsToDelete.push(entityId)
            }
        }

        // Add orphaned fact nodes
        if (orphanedFacts) {
            for (const factId of orphanedFacts) {
                if (this.graph.hasNode(factId)) {
                    allNodeIdsToDelete.push(factId)
                }
            }
        }

        // Remove nodes from graph if any exist
        if (allNodeIdsToDelete.length > 0) {
            this.graph.deleteVertices(allNodeIdsToDelete)
            this.ctx.logger.success(
                `Removed ${allNodeIdsToDelete.length} nodes from graph`
            )
        }

        // Clean up entity-to-chunk mappings
        if (this.entNodeToChunkIds) {
            for (const entityId of this.entNodeToChunkIds.keys()) {
                const chunkIds = this.entNodeToChunkIds.get(entityId)!
                for (const chunkId of chunkIdsToDelete) {
                    chunkIds.delete(chunkId)
                }
                if (chunkIds.size === 0) {
                    this.entNodeToChunkIds.delete(entityId)
                }
            }

            // Remove orphaned entity mappings
            for (const entityId of orphanedEntities) {
                this.entNodeToChunkIds.delete(entityId)
            }
        }

        // Clean up node-to-node statistics for all deleted nodes
        const keysToDelete: string[] = []
        for (const edgeKey of this.nodeToNodeStats.keys()) {
            const [sourceId, targetId] = edgeKey.split('|')
            if (
                allNodeIdsToDelete.includes(sourceId) ||
                allNodeIdsToDelete.includes(targetId)
            ) {
                keysToDelete.push(edgeKey)
            }
        }

        for (const key of keysToDelete) {
            this.nodeToNodeStats.delete(key)
        }

        // Clear retrieval preparation flags and cached data
        this.readyToRetrieve = false
        this.entityNodeKeys = []
        this.passageNodeKeys = []
        this.factNodeKeys = []
        this.nodeNameToVertexIdx.clear()
        this.entityNodeIdxs = []
        this.passageNodeIdxs = []

        this.procTriplesToDocs.clear()

        // Save graph only if nodes were actually deleted
        if (allNodeIdsToDelete.length > 0) {
            await this.saveGraph()
        }
    }

    /**
     * Deletes the given documents from all data structures within the HippoRAG class
     */
    async delete(docIds: string[]): Promise<void> {
        if (!docIds || docIds.length === 0) {
            this.ctx.logger.warn('No document IDs provided for deletion')
            return
        }

        // Ensure vector stores are initialized before attempting deletion
        try {
            this.ctx.logger.success(
                'Ensuring vector stores are initialized for deletion...'
            )
            await this.initialize()
            this.ctx.logger.success('Vector stores initialization complete')
        } catch (error) {
            this.ctx.logger.error(
                `Failed to initialize vector stores for deletion: ${error}`
            )
            throw new Error(`Store initialization failed: ${error}`)
        }

        // Guard against missing vector stores after initialization
        if (
            !this.chunkEmbeddingStore ||
            !this.entityEmbeddingStore ||
            !this.factEmbeddingStore
        ) {
            this.ctx.logger.error(
                'Vector stores are not properly initialized after initialization attempt'
            )
            throw new Error(
                'Vector stores are not available for deletion operation'
            )
        }

        this.ctx.logger.success(`Deleting ${docIds.length} documents...`)

        const chunkIdsToDelete = this.normalizeDocIdsToChunkIds(docIds)

        const { entitiesToRemove, factsToRemove, docsToKeep } =
            await this.collectOpenIERemovals(chunkIdsToDelete)

        await this.removeChunksFromStore(Array.from(chunkIdsToDelete))

        const { orphanedEntities, orphanedFacts } =
            await this.computeRemainingRefsAndOrphans(
                docsToKeep,
                entitiesToRemove,
                factsToRemove
            )

        await this.removeEntitiesFromStore(Array.from(orphanedEntities))
        await this.removeFactsFromStore(Array.from(orphanedFacts))

        await this.updateGraphAndMappings(
            [],
            chunkIdsToDelete,
            orphanedEntities,
            orphanedFacts
        )

        this.ctx.logger.success(
            `Successfully deleted ${docIds.length} documents and cleaned up associated data`
        )
    }

    /**
     * Performs retrieval using the HippoRAG framework
     */
    async retrieve(
        queries: string[],
        numToRetrieve?: number
    ): Promise<QuerySolution[]> {
        const retrieveStartTime = Date.now()

        // Ensure vector stores and retrieval dependencies are initialized first
        try {
            this.ctx.logger.success(
                'Ensuring vector stores are initialized for retrieval...'
            )
            await this.initialize()
            this.ctx.logger.success('Vector stores initialization complete')
        } catch (error) {
            this.ctx.logger.error(
                `Failed to initialize vector stores for retrieval: ${error}`
            )
            throw new Error(`Store initialization failed: ${error}`)
        }

        if (!numToRetrieve) {
            numToRetrieve = this.globalConfig.retrievalTopK
        }

        // Prepare retrieval objects and validate readiness
        if (!this.readyToRetrieve) {
            try {
                this.ctx.logger.success('Preparing retrieval objects...')
                await this.prepareRetrievalObjects()
                this.ctx.logger.success(
                    'Retrieval objects prepared successfully'
                )
            } catch (error) {
                this.ctx.logger.error(
                    `Failed to prepare retrieval objects: ${error}`
                )
                throw new Error(`Retrieval preparation failed: ${error}`)
            }
        }

        // Validate retrieval readiness before proceeding
        if (!this.readyToRetrieve) {
            this.ctx.logger.error(
                'Retrieval objects are not ready after preparation attempt'
            )
            throw new Error('Retrieval system is not properly initialized')
        }

        await this.getQueryEmbeddings(queries)

        const retrievalResults: QuerySolution[] = []

        const chunkDocs = await this.chunkEmbeddingStore.docstore.list()
        const chunkDocMap = new Map(
            chunkDocs.map((doc) => [doc.metadata.id, doc])
        )

        const factDocs = await this.factEmbeddingStore.docstore.list()
        const factDocMap = new Map(
            factDocs.map((doc) => [
                computeMDHashId(doc.pageContent, 'fact-'),
                doc
            ])
        )

        for (let qIdx = 0; qIdx < queries.length; qIdx++) {
            const query = queries[qIdx]

            // Get fact scores
            const queryFactScores = await this.getFactScores(query)

            // Rerank facts using LLM
            const [topKFactIndices, topKFacts] = await this.rerankFacts(
                query,
                queryFactScores,
                factDocMap
            )

            if (topKFacts.length === 0) {
                this.ctx.logger.success(
                    'No facts found after reranking, return DPR results'
                )
                const [sortedDocIds, sortedDocScores] =
                    await this.densePassageRetrieval(query)

                // Get top documents
                const topKDocs: Document[] = []
                for (
                    let i = 0;
                    i < Math.min(numToRetrieve, sortedDocIds.length);
                    i++
                ) {
                    const docIndex = sortedDocIds[i]
                    if (
                        docIndex >= 0 &&
                        docIndex < this.passageNodeKeys.length
                    ) {
                        const passageNodeKey = this.passageNodeKeys[docIndex]
                        const doc = chunkDocMap.get(passageNodeKey)
                        if (doc) {
                            topKDocs.push(doc)
                        }
                    }
                }

                retrievalResults.push({
                    question: query,
                    docs: topKDocs,
                    docScores: sortedDocScores.slice(0, numToRetrieve)
                })
            } else {
                // Use graph search with fact entities
                const [sortedDocIds, sortedDocScores] =
                    await this.graphSearchWithFactEntities(
                        query,
                        this.globalConfig.linkingTopK!,
                        queryFactScores,
                        topKFacts,
                        topKFactIndices.map(String),
                        this.globalConfig.passageNodeWeight!
                    )

                const topKDocs: Document[] = []
                for (
                    let i = 0;
                    i < Math.min(numToRetrieve, sortedDocIds.length);
                    i++
                ) {
                    const docIndex = sortedDocIds[i]
                    if (
                        docIndex >= 0 &&
                        docIndex < this.passageNodeKeys.length
                    ) {
                        const passageNodeKey = this.passageNodeKeys[docIndex]
                        const doc = chunkDocMap.get(passageNodeKey)
                        if (doc) {
                            topKDocs.push(doc)
                        }
                    }
                }

                retrievalResults.push({
                    question: query,
                    docs: topKDocs,
                    docScores: sortedDocScores.slice(0, numToRetrieve)
                })
            }
        }

        const retrieveEndTime = Date.now()
        this.allRetrievalTime += retrieveEndTime - retrieveStartTime

        this.ctx.logger.success(
            `Total Retrieval Time ${this.allRetrievalTime}ms`
        )

        return retrievalResults
    }

    /**
     * Adds fact edges from given triples to the graph
     */
    private addFactEdges(chunkIds: string[], chunkTriples: Triple[][]): void {
        const currentGraphNodes = new Set(this.graph.getNodeIds())

        this.ctx.logger.success('Adding OpenIE triples to graph.')

        for (let i = 0; i < chunkIds.length; i++) {
            const chunkKey = chunkIds[i]
            const triples = chunkTriples[i]
            const entitiesInChunk = new Set<string>()

            // Determine if the chunk is new before processing
            const isNewChunk = !currentGraphNodes.has(chunkKey)

            for (const triple of triples) {
                const [subject, , object] = triple
                const nodeKey = computeMDHashId(subject, 'entity-')
                const node2Key = computeMDHashId(object, 'entity-')

                entitiesInChunk.add(nodeKey)
                entitiesInChunk.add(node2Key)

                // Only update co-occurrence stats for new chunks
                if (isNewChunk) {
                    const forwardKey = `${nodeKey}|${node2Key}`
                    const backwardKey = `${node2Key}|${nodeKey}`

                    this.nodeToNodeStats.set(
                        forwardKey,
                        (this.nodeToNodeStats.get(forwardKey) || 0) + 1
                    )
                    this.nodeToNodeStats.set(
                        backwardKey,
                        (this.nodeToNodeStats.get(backwardKey) || 0) + 1
                    )
                }
            }

            // Unconditionally update the entity-to-chunk mapping
            for (const entityNode of entitiesInChunk) {
                if (!this.entNodeToChunkIds.has(entityNode)) {
                    this.entNodeToChunkIds.set(entityNode, new Set())
                }
                this.entNodeToChunkIds.get(entityNode)!.add(chunkKey)
            }
        }
    }

    /**
     * Adds edges connecting passage nodes to phrase nodes in the graph
     */
    private addPassageEdges(
        chunkIds: string[],
        chunkTripleEntities: string[][]
    ): number {
        const currentGraphNodes = new Set(this.graph.getNodeIds())
        let numNewChunks = 0

        this.ctx.logger.success('Connecting passage nodes to phrase nodes.')

        for (let i = 0; i < chunkIds.length; i++) {
            const chunkKey = chunkIds[i]
            const isNewChunk = !currentGraphNodes.has(chunkKey)

            for (const chunkEnt of chunkTripleEntities[i]) {
                const nodeKey = computeMDHashId(chunkEnt, 'entity-')

                // Unconditionally update the entity-to-chunk mapping
                if (!this.entNodeToChunkIds.has(nodeKey)) {
                    this.entNodeToChunkIds.set(nodeKey, new Set())
                }
                this.entNodeToChunkIds.get(nodeKey)!.add(chunkKey)

                // Only update stats and edges for new chunks
                if (isNewChunk) {
                    const edgeKey = `${chunkKey}|${nodeKey}`
                    this.nodeToNodeStats.set(edgeKey, 1.0)
                }
            }

            if (isNewChunk) {
                numNewChunks++
            }
        }

        return numNewChunks
    }

    /**
     * Adds synonymy edges between similar nodes in the graph using vector search
     */
    private async addSynonymyEdges(): Promise<void> {
        this.ctx.logger.success('Expanding graph with synonymy edges')

        const entityDocs = await this.entityEmbeddingStore.docstore.list()

        this.ctx.logger.success(
            `Performing vector search for each phrase nodes (${entityDocs.length}).`
        )

        let numSynonymTriple = 0
        const synonymCandidates: [string, [string, number][]][] = []

        for (const entityDoc of entityDocs) {
            const sourceEntity = entityDoc.pageContent
            const synonyms: [string, number][] = []

            // Filter out very short entities (less than 3 alphanumeric characters)
            if (sourceEntity.replace(/[^A-Za-z0-9]/g, '').length > 2) {
                // Search for similar entities using vector search
                const results =
                    await this.entityEmbeddingStore.similaritySearchWithScore(
                        sourceEntity,
                        this.globalConfig.synonymyEdgeTopK + 1 // +1 to include self
                    )

                let numNns = 0
                for (const [neighborDoc, similarity] of results) {
                    // Skip if it's the same entity or empty
                    if (
                        neighborDoc.pageContent === sourceEntity ||
                        neighborDoc.pageContent === ''
                    ) {
                        continue
                    }

                    // Check similarity threshold
                    if (
                        similarity <
                            this.globalConfig.synonymyEdgeSimThreshold ||
                        numNns > 100
                    ) {
                        break
                    }

                    const neighborEntity = neighborDoc.pageContent
                    const sourceNodeKey = computeMDHashId(
                        sourceEntity,
                        'entity-'
                    )
                    const neighborNodeKey = computeMDHashId(
                        neighborEntity,
                        'entity-'
                    )

                    // Add synonymy edge
                    const edgeKey = `${sourceNodeKey}|${neighborNodeKey}`
                    synonyms.push([neighborNodeKey, similarity])
                    numSynonymTriple++

                    this.nodeToNodeStats.set(edgeKey, similarity)
                    numNns++
                }
            }

            if (synonyms.length > 0) {
                const sourceNodeKey = computeMDHashId(sourceEntity, 'entity-')
                synonymCandidates.push([sourceNodeKey, synonyms])
            }
        }

        this.ctx.logger.success(
            `Found ${numSynonymTriple} synonymy relationships`
        )
    }

    /**
     * Loads existing OpenIE results from the specified file if it exists
     */
    private async loadExistingOpenIE(
        chunkKeys: string[]
    ): Promise<[OpenIEDocument[], Set<string>]> {
        const chunkKeysToSave = new Set<string>()

        if (await this.openie.exists()) {
            const allOpenieInfo = await this.openie.load()

            // Standardize indices for OpenIE files
            const renamedOpenieInfo: OpenIEDocument[] = []
            for (const openieInfo of allOpenieInfo) {
                openieInfo.idx = computeMDHashId(openieInfo.passage, 'chunk-')
                renamedOpenieInfo.push(openieInfo)
            }

            const existingOpenieKeys = new Set(
                renamedOpenieInfo.map((info) => info.idx)
            )

            for (const chunkKey of chunkKeys) {
                if (!existingOpenieKeys.has(chunkKey)) {
                    chunkKeysToSave.add(chunkKey)
                }
            }

            return [renamedOpenieInfo, chunkKeysToSave]
        } else {
            for (const chunkKey of chunkKeys) {
                chunkKeysToSave.add(chunkKey)
            }
            return [[], chunkKeysToSave]
        }
    }

    /**
     * Augments the graph by adding new nodes and edges
     */
    private async augmentGraph(): Promise<void> {
        await this.addNewNodes()
        this.addNewEdges()

        this.ctx.logger.success('Graph construction completed!')
        const graphInfo = this.getGraphInfo()
        this.ctx.logger.success(`Graph info: ${JSON.stringify(graphInfo)}`)
    }

    /**
     * Adds new nodes to the graph from entity and passage embedding stores
     */
    private async addNewNodes(): Promise<void> {
        const existingNodes = new Set(this.graph.getNodeIds())

        // Get entity nodes
        const allEntDocs = await this.entityEmbeddingStore.docstore.list()
        const entityNodes = new Map<string, GraphNode>()
        for (const doc of allEntDocs) {
            const nodeId = computeMDHashId(doc.pageContent, 'entity-')
            if (!existingNodes.has(nodeId)) {
                entityNodes.set(nodeId, {
                    id: nodeId,
                    name: nodeId,
                    content: doc.pageContent,
                    metadata: { type: 'entity', content: doc.pageContent }
                })
            }
        }

        // Get passage nodes
        const allPassageDocs = await this.chunkEmbeddingStore.docstore.list()
        const passageNodes = new Map<string, GraphNode>()
        for (const doc of allPassageDocs) {
            const nodeId = doc.metadata.id as string
            if (!existingNodes.has(nodeId)) {
                passageNodes.set(nodeId, {
                    id: nodeId,
                    name: nodeId,
                    content: doc.pageContent,
                    metadata: { type: 'passage', content: doc.pageContent }
                })
            }
        }

        // Get fact nodes
        const allFactDocs = await this.factEmbeddingStore.docstore.list()
        const factNodes = new Map<string, GraphNode>()
        for (const doc of allFactDocs) {
            const nodeId = computeMDHashId(doc.pageContent, 'fact-')
            if (!existingNodes.has(nodeId)) {
                factNodes.set(nodeId, {
                    id: nodeId,
                    name: nodeId,
                    content: doc.pageContent,
                    metadata: { type: 'fact', content: doc.pageContent }
                })
            }
        }

        // Combine all new nodes
        const allNewNodes = [
            ...Array.from(entityNodes.values()),
            ...Array.from(passageNodes.values()),
            ...Array.from(factNodes.values())
        ]

        if (allNewNodes.length > 0) {
            this.graph.addVertices(allNewNodes)
        }
    }

    /**
     * Processes edges from nodeToNodeStats to add them into a graph object
     */
    private addNewEdges(): void {
        const currentNodeIds = new Set(this.graph.getNodeIds())
        const edgesToAdd: GraphEdge[] = []

        for (const [edgeKey, weight] of this.nodeToNodeStats.entries()) {
            const [sourceId, targetId] = edgeKey.split('|')

            // Check if both nodes exist in the graph
            if (currentNodeIds.has(sourceId) && currentNodeIds.has(targetId)) {
                // Check if edge doesn't already exist
                if (this.graph.getEdgeWeight(sourceId, targetId) === 0) {
                    edgesToAdd.push({
                        source: sourceId,
                        target: targetId,
                        weight,
                        metadata: { type: 'computed' }
                    })
                }
            } else {
                this.ctx.logger.warn(
                    `Edge ${sourceId} -> ${targetId} is not valid - nodes missing`
                )
            }
        }

        if (edgesToAdd.length > 0) {
            this.graph.addEdges(edgesToAdd)
        }
    }

    /**
     * Saves the graph to file
     */
    async saveGraph(): Promise<void> {
        this.ctx.logger.success(
            `Writing graph with ${this.graph.vcount} nodes, ${this.graph.ecount} edges`
        )
        await this.graph.serialize(this._graphPickleFilename)
        this.ctx.logger.success('Saving graph completed!')
    }

    /**
     * Gets detailed information about the graph
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getGraphInfo(): Record<string, any> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const graphInfo: Record<string, any> = {}

        // Get # of phrase nodes (entities)
        graphInfo.numPhraseNodes = this.entityNodeKeys.length

        // Get # of passage nodes (chunks)
        graphInfo.numPassageNodes = this.passageNodeKeys.length

        // Get # of fact nodes
        graphInfo.numFactNodes = this.factNodeKeys.length

        // Get # of total nodes
        graphInfo.numTotalNodes = this.graph.vcount

        // Get # of extracted triples (facts)
        graphInfo.numExtractedTriples = this.factNodeKeys.length

        // Count triples with passage nodes
        let numTriplesWithPassageNode = 0
        const passageNodeSet = new Set(this.passageNodeKeys)
        for (const edgeKey of this.nodeToNodeStats.keys()) {
            const [node1, node2] = edgeKey.split('|')
            if (passageNodeSet.has(node1) || passageNodeSet.has(node2)) {
                numTriplesWithPassageNode++
            }
        }
        graphInfo.numTriplesWithPassageNode = numTriplesWithPassageNode

        // Calculate synonymy triples
        graphInfo.numSynonymyTriples =
            this.nodeToNodeStats.size -
            graphInfo.numExtractedTriples -
            numTriplesWithPassageNode

        // Get # of total triples
        graphInfo.numTotalTriples = this.nodeToNodeStats.size

        // Get graph statistics
        const graphStats = this.graph.getStats()
        graphInfo.density = graphStats.density
        graphInfo.memoryUsage = graphStats.memoryUsage

        return graphInfo
    }

    /**
     * Prepares various in-memory objects and attributes necessary for fast retrieval processes
     */
    private async prepareRetrievalObjects(): Promise<void> {
        this.ctx.logger.success('Preparing for fast retrieval.')

        this.ctx.logger.success('Loading keys.')
        this.queryToEmbedding = {
            triple: new Map(),
            passage: new Map()
        }

        // Load entity node keys
        const allEntityDocs = await this.entityEmbeddingStore.docstore.list()
        this.entityNodeKeys = allEntityDocs.map((doc) =>
            computeMDHashId(doc.pageContent, 'entity-')
        )

        // Load passage node keys
        const allPassageDocs = await this.chunkEmbeddingStore.docstore.list()
        this.passageNodeKeys = allPassageDocs.map(
            (doc) => doc.metadata.id as string
        )

        // Load fact node keys
        const allFactDocs = await this.factEmbeddingStore.docstore.list()
        this.factNodeKeys = allFactDocs.map((doc) =>
            computeMDHashId(doc.pageContent, 'fact-')
        )

        // Check if the graph has the expected number of nodes
        const expectedNodeCount =
            this.entityNodeKeys.length +
            this.passageNodeKeys.length +
            this.factNodeKeys.length
        const actualNodeCount = this.graph.vcount

        if (expectedNodeCount !== actualNodeCount) {
            this.ctx.logger.warn(
                `Graph node count mismatch: expected ${expectedNodeCount}, got ${actualNodeCount}`
            )

            // If the graph is empty but we have nodes, we need to add them
            if (actualNodeCount === 0 && expectedNodeCount > 0) {
                this.ctx.logger.success(
                    `Initializing graph with ${expectedNodeCount} nodes`
                )
                await this.addNewNodes()
                await this.saveGraph()
            }
        }

        // Create mapping from node name to vertex index
        try {
            const allNodeIds = this.graph.getNodeIds()
            this.nodeNameToVertexIdx = new Map()

            allNodeIds.forEach((nodeId, index) => {
                this.nodeNameToVertexIdx.set(nodeId, index)
            })

            // Check if all entity and passage nodes are in the graph
            const missingEntityNodes = this.entityNodeKeys.filter(
                (nodeKey) => !this.nodeNameToVertexIdx.has(nodeKey)
            )
            const missingPassageNodes = this.passageNodeKeys.filter(
                (nodeKey) => !this.nodeNameToVertexIdx.has(nodeKey)
            )

            if (
                missingEntityNodes.length > 0 ||
                missingPassageNodes.length > 0
            ) {
                this.ctx.logger.warn(
                    `Missing nodes in graph: ${missingEntityNodes.length} entity nodes, ${missingPassageNodes.length} passage nodes`
                )
                // If nodes are missing, rebuild the graph
                await this.addNewNodes()
                this.addNewEdges()
                await this.saveGraph()

                // Update the mapping
                const updatedNodeIds = this.graph.getNodeIds()
                this.nodeNameToVertexIdx.clear()
                updatedNodeIds.forEach((nodeId, index) => {
                    this.nodeNameToVertexIdx.set(nodeId, index)
                })
            }

            this.entityNodeIdxs = this.entityNodeKeys
                .map((nodeKey) => this.nodeNameToVertexIdx.get(nodeKey))
                .filter((idx) => idx !== undefined) as number[]

            this.passageNodeIdxs = this.passageNodeKeys
                .map((nodeKey) => this.nodeNameToVertexIdx.get(nodeKey))
                .filter((idx) => idx !== undefined) as number[]
        } catch (error) {
            this.ctx.logger.error(`Error creating node index mapping: ${error}`)
            // Initialize with empty lists if mapping fails
            this.nodeNameToVertexIdx = new Map()
            this.entityNodeIdxs = []
            this.passageNodeIdxs = []
        }

        this.ctx.logger.success('Loading embeddings.')

        // Load existing OpenIE info for processing triples to docs mapping
        const [allOpenieInfo] = await this.loadExistingOpenIE([])
        this.procTriplesToDocs = new Map()

        for (const doc of allOpenieInfo) {
            const triples = flattenFacts([doc.extractedTriples])
            for (const triple of triples) {
                if (triple.length === 3) {
                    const procTriple = textProcessing(triple).join('|')
                    if (!this.procTriplesToDocs.has(procTriple)) {
                        this.procTriplesToDocs.set(procTriple, new Set())
                    }
                    this.procTriplesToDocs.get(procTriple)!.add(doc.idx)
                }
            }
        }

        // If entNodeToChunkIds is not set, rebuild it
        if (!this.entNodeToChunkIds) {
            const { nerResultsDict, tripleResultsDict } =
                reformatOpenIEResults(allOpenieInfo)

            // Check if the lengths match
            if (
                this.passageNodeKeys.length !==
                    Object.keys(nerResultsDict).length ||
                this.passageNodeKeys.length !==
                    Object.keys(tripleResultsDict).length
            ) {
                this.ctx.logger.warn(
                    `Length mismatch: passageNodeKeys=${this.passageNodeKeys.length}, ner=${Object.keys(nerResultsDict).length}, triples=${Object.keys(tripleResultsDict).length}`
                )
            }

            // Prepare data and rebuild entity to chunk mapping
            const chunkTriples = this.passageNodeKeys.map(
                (chunkId) =>
                    tripleResultsDict[chunkId]?.triples?.map((t) =>
                        textProcessing(t)
                    ) || []
            )

            this.nodeToNodeStats = new Map()
            this.entNodeToChunkIds = new Map()
            this.addFactEdges(this.passageNodeKeys, chunkTriples)
        }

        this.readyToRetrieve = true
    }

    /**
     * Retrieves embeddings for given queries and updates the internal query-to-embedding mapping
     */
    private async getQueryEmbeddings(
        queries: string[] | QuerySolution[]
    ): Promise<void> {
        const allQueryStrings: string[] = []

        for (const query of queries) {
            let queryString: string
            if (typeof query === 'string') {
                queryString = query
            } else {
                queryString = query.question
            }

            // Check if embeddings already exist for this query
            if (
                !this.queryToEmbedding.triple.has(queryString) ||
                !this.queryToEmbedding.passage.has(queryString)
            ) {
                allQueryStrings.push(queryString)
            }
        }

        if (allQueryStrings.length > 0) {
            // Get all query embeddings for fact retrieval
            this.ctx.logger.success(
                `Encoding ${allQueryStrings.length} queries for query_to_fact, query_to_passage.`
            )

            for (const queryString of allQueryStrings) {
                // For query to fact matching, we can use the same instruction as passage
                // or create a specialized instruction if needed
                const queryEmbeddingForTriple =
                    await this.embeddingModel.embedQuery(queryString)
                this.queryToEmbedding.triple.set(
                    queryString,
                    queryEmbeddingForTriple
                )
                this.queryToEmbedding.passage.set(
                    queryString,
                    queryEmbeddingForTriple
                )
            }
        }
    }

    /**
     * Retrieves and computes normalized similarity scores between the given query and pre-stored fact embeddings
     */
    private async getFactScores(query: string): Promise<number[]> {
        const queryEmbedding = this.queryToEmbedding.triple.get(query)

        if (!queryEmbedding) {
            // If embedding doesn't exist, we need to compute it
            // This is a fallback, ideally getQueryEmbeddings should be called first
            this.ctx.logger.warn(
                `Query embedding not found for: ${query}. Computing on-demand.`
            )
            // Return empty array as we can't compute synchronously
            return []
        }

        try {
            // Build O(1) lookup map from factNodeKeys to their indices
            const factKeyToIndex = new Map<string, number>()
            this.factNodeKeys.forEach((key, index) => {
                factKeyToIndex.set(key, index)
            })

            const indexedScores = await this.factEmbeddingStore
                .similaritySearchVectorWithScore(
                    queryEmbedding,
                    Math.max(1, (this.globalConfig.linkingTopK ?? 100) * 3)
                )
                .then((scores) => {
                    if (scores.length === 0) {
                        return []
                    }
                    // Map to { factIndex, score } and filter out invalid indices
                    return scores
                        .map((doc, index) => {
                            const id =
                                doc[0].metadata?.id ??
                                doc[0].id ??
                                `fallback-${index}`
                            return {
                                score: doc[1],
                                factIndex: factKeyToIndex.get(id) ?? -1
                            }
                        })
                        .filter((item) => item.factIndex !== -1)
                })

            // Return an array of zeros if no valid facts were found
            if (indexedScores.length === 0) {
                return new Array(this.factNodeKeys.length).fill(0)
            }

            const scoresOnly = indexedScores.map((item) => item.score)
            const minScore = Math.min(...scoresOnly)
            const maxScore = Math.max(...scoresOnly)
            const range = maxScore - minScore

            // Initialize a fixed-length array aligned with factNodeKeys
            const normalizedScores = new Array(this.factNodeKeys.length).fill(0)

            if (range === 0) {
                // If all scores are the same, assign a normalized value (e.g., 1.0) to the found facts
                for (const item of indexedScores) {
                    normalizedScores[item.factIndex] = 1.0
                }
            } else {
                // Normalize and place scores at their correct index
                for (const item of indexedScores) {
                    normalizedScores[item.factIndex] =
                        (item.score - minScore) / range
                }
            }

            return normalizedScores
        } catch (error) {
            this.ctx.logger.error(`Error computing fact scores: ${error}`)
            return []
        }
    }

    /**
     * Conducts dense passage retrieval to find relevant documents for a query
     */
    private async densePassageRetrieval(
        query: string
    ): Promise<[number[], number[]]> {
        const queryEmbedding = this.queryToEmbedding.passage.get(query)

        if (!queryEmbedding) {
            this.ctx.logger.warn(
                `Query embedding not found for passage retrieval: ${query}`
            )
            return [[], []]
        }

        try {
            // Build O(1) lookup map from passageNodeKeys to their indices
            const passageKeyToIndex = new Map<string, number>()
            this.passageNodeKeys.forEach((key, index) => {
                passageKeyToIndex.set(key, index)
            })

            // Compute similarity scores between query and all passages
            const dprTopK = 200 // A reasonable hard cap, can be made configurable
            const count = await this.chunkEmbeddingStore.docstore
                .stat()
                .then((stat) => stat.count)
            const topKCandidates = Math.min(dprTopK, count)
            const indexedScores = await this.chunkEmbeddingStore
                .similaritySearchVectorWithScore(queryEmbedding, topKCandidates)
                .then((scores) => {
                    // Early guard for empty similarity results
                    if (scores.length === 0) {
                        return []
                    }

                    return scores
                        .map((doc, index) => ({
                            id:
                                doc[0].metadata?.id ??
                                doc[0].id ??
                                `fallback-${index}`,
                            score: doc[1],
                            passageIndex:
                                passageKeyToIndex.get(
                                    doc[0].metadata?.id ??
                                        doc[0].id ??
                                        `fallback-${index}`
                                ) ?? -1
                        }))
                        .sort((a, b) => {
                            // Handle missing keys by assigning large deterministic indices
                            const aSort =
                                a.passageIndex === -1
                                    ? Number.MAX_SAFE_INTEGER
                                    : a.passageIndex
                            const bSort =
                                b.passageIndex === -1
                                    ? Number.MAX_SAFE_INTEGER
                                    : b.passageIndex
                            return aSort - bSort
                        })
                })

            // Filter out entries with invalid passageIndex
            const validScores = indexedScores.filter(
                (item) => item.passageIndex >= 0
            )

            if (validScores.length < indexedScores.length) {
                this.ctx.logger.warn(
                    `Dropped ${
                        indexedScores.length - validScores.length
                    } DPR hits with invalid passageIndex.`
                )
            }

            // Extract sorted document indices and scores
            const sortedDocIds = validScores.map((item) => item.passageIndex)
            const sortedDocScores = validScores.map((item) => item.score)

            return [sortedDocIds, sortedDocScores]
        } catch (error) {
            this.ctx.logger.error(`Error in dense passage retrieval: ${error}`)
            return [[], []]
        }
    }

    /**
     * Filters phrase weights to retain only the weights for the top-ranked phrases
     */
    private getTopKWeights(
        linkTopK: number,
        allPhraseWeights: number[],
        linkingScoreMap: Record<string, number>
    ): [number[], Record<string, number>] {
        // Choose top ranked nodes in linking_score_map
        const sortedEntries = Object.entries(linkingScoreMap)
            .sort(([, a], [, b]) => b - a)
            .slice(0, linkTopK)

        const filteredLinkingScoreMap = Object.fromEntries(sortedEntries)

        // Only keep the top_k phrases in all_phrase_weights
        const topKPhrases = new Set(Object.keys(filteredLinkingScoreMap))
        const topKPhrasesKeys = new Set(
            Array.from(topKPhrases).map((phrase) =>
                computeMDHashId(phrase, 'entity-')
            )
        )

        // Create a copy of phrase weights to modify
        const filteredPhraseWeights = [...allPhraseWeights]

        // Zero out weights for phrases not in top K
        for (const [
            phraseKey,
            phraseId
        ] of this.nodeNameToVertexIdx.entries()) {
            if (!topKPhrasesKeys.has(phraseKey)) {
                if (phraseId < filteredPhraseWeights.length) {
                    filteredPhraseWeights[phraseId] = 0.0
                }
            }
        }

        // Count non-zero weights to verify
        const nonZeroCount = filteredPhraseWeights.filter((w) => w !== 0).length
        if (nonZeroCount !== Object.keys(filteredLinkingScoreMap).length) {
            this.ctx.logger.warn(
                `Weight count mismatch: ${nonZeroCount} non-zero weights vs ${Object.keys(filteredLinkingScoreMap).length} top phrases`
            )
        }

        return [filteredPhraseWeights, filteredLinkingScoreMap]
    }

    /**
     * Computes document scores based on fact-based similarity and relevance using personalized PageRank
     */
    private async graphSearchWithFactEntities(
        query: string,
        linkTopK: number,
        queryFactScores: number[],
        topKFacts: Triple[],
        topKFactIndices: string[],
        passageNodeWeight: number = 0.05
    ): Promise<[number[], number[]]> {
        // Assigning phrase weights based on selected facts from previous steps
        const linkingScoreMap: Record<string, number> = {} // from phrase to the average scores of the facts that contain the phrase
        const phraseScores: Record<string, number[]> = {} // store all fact scores for each phrase

        const graphNodeCount = this.graph.vcount
        const phraseWeights = new Array(graphNodeCount).fill(0)
        const passageWeights = new Array(graphNodeCount).fill(0)
        const numberOfOccurs = new Array(graphNodeCount).fill(0)

        const phrasesAndIds: [string, number | undefined][] = []

        // Process each fact to assign weights to phrases
        for (let rank = 0; rank < topKFacts.length; rank++) {
            const fact = topKFacts[rank]
            let factScore: number

            if (queryFactScores.length > 0) {
                const factIndex = parseInt(topKFactIndices[rank], 10)
                factScore = queryFactScores[factIndex] || 0
            } else {
                factScore = 0
            }

            // Extract subject and object from fact (assuming fact is [subject, predicate, object])
            const subjectPhrase = textProcessing(String(fact[0]))
            const objectPhrase = textProcessing(String(fact[2]))

            for (const phrase of [subjectPhrase, objectPhrase]) {
                const phraseKey = computeMDHashId(phrase, 'entity-')
                const phraseId = this.nodeNameToVertexIdx.get(phraseKey)

                if (phraseId !== undefined) {
                    let weightedFactScore = factScore

                    // Weight by inverse document frequency (entities in fewer chunks get higher weight)
                    const chunkIds = this.entNodeToChunkIds?.get(phraseKey)
                    if (chunkIds && chunkIds.size > 0) {
                        weightedFactScore /= chunkIds.size
                    }

                    phraseWeights[phraseId] += weightedFactScore
                    numberOfOccurs[phraseId] += 1

                    phrasesAndIds.push([phrase, phraseId])
                }
            }
        }

        // Normalize phrase weights by number of occurrences
        for (let i = 0; i < phraseWeights.length; i++) {
            if (numberOfOccurs[i] > 0) {
                phraseWeights[i] /= numberOfOccurs[i]
            }
        }

        // Build phrase scores map
        for (const [phrase, phraseId] of phrasesAndIds) {
            if (phraseId !== undefined) {
                if (!phraseScores[phrase]) {
                    phraseScores[phrase] = []
                }
                phraseScores[phrase].push(phraseWeights[phraseId])
            }
        }

        // Calculate average fact score for each phrase
        for (const [phrase, scores] of Object.entries(phraseScores)) {
            if (scores.length > 0) {
                linkingScoreMap[phrase] =
                    scores.reduce((sum, score) => sum + score, 0) /
                    scores.length
            }
        }

        // Apply top-K filtering if specified
        let finalPhraseWeights = phraseWeights
        let finalLinkingScoreMap = linkingScoreMap

        if (linkTopK > 0) {
            ;[finalPhraseWeights, finalLinkingScoreMap] = this.getTopKWeights(
                linkTopK,
                phraseWeights,
                linkingScoreMap
            )
        }

        // Get passage scores according to dense retrieval model
        const [dprSortedDocIds, dprSortedDocScores] =
            await this.densePassageRetrieval(query)

        // Normalize DPR scores with guard for empty array
        let normalizedDprScores: number[]
        if (dprSortedDocScores.length === 0) {
            normalizedDprScores = []
        } else {
            const minDprScore = Math.min(...dprSortedDocScores)
            const maxDprScore = Math.max(...dprSortedDocScores)
            const dprRange = maxDprScore - minDprScore

            normalizedDprScores =
                dprRange === 0
                    ? new Array(dprSortedDocScores.length).fill(0)
                    : dprSortedDocScores.map(
                          (score) => (score - minDprScore) / dprRange
                      )
        }

        // Add passage weights
        for (let i = 0; i < dprSortedDocIds.length; i++) {
            const dprSortedDocId = dprSortedDocIds[i]
            if (dprSortedDocId < this.passageNodeKeys.length) {
                const passageNodeKey = this.passageNodeKeys[dprSortedDocId]
                const passageDprScore = normalizedDprScores[i]
                const passageNodeId =
                    this.nodeNameToVertexIdx.get(passageNodeKey)

                if (passageNodeId !== undefined) {
                    passageWeights[passageNodeId] =
                        passageDprScore * passageNodeWeight

                    // Add to linking score map for tracking
                    try {
                        // Get passage content for the linking score map
                        const passageContent = `passage_${passageNodeKey}`
                        finalLinkingScoreMap[passageContent] =
                            passageDprScore * passageNodeWeight
                    } catch (error) {
                        this.ctx.logger.warn(
                            `Could not get passage content for ${passageNodeKey}`
                        )
                    }
                }
            }
        }

        // Combine phrase and passage scores into one array for PPR
        const nodeWeights = new Array(graphNodeCount).fill(0)
        for (let i = 0; i < graphNodeCount; i++) {
            nodeWeights[i] = finalPhraseWeights[i] + passageWeights[i]
        }

        // Keep only top 30 facts in linking_score_map for logging
        if (Object.keys(finalLinkingScoreMap).length > 30) {
            const topEntries = Object.entries(finalLinkingScoreMap)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 30)
            finalLinkingScoreMap = Object.fromEntries(topEntries)
        }

        // Check that we have non-zero weights
        const totalWeight = nodeWeights.reduce((sum, weight) => sum + weight, 0)
        if (totalWeight === 0) {
            this.ctx.logger.warn(
                `No phrases found in the graph for the given facts: ${JSON.stringify(topKFacts)}`
            )
            return [[], []]
        }

        // Run PPR algorithm based on the passage and phrase weights
        const pprStart = Date.now()
        const [pprSortedDocIds, pprSortedDocScores] = this.runPpr(
            nodeWeights,
            this.globalConfig.damping!
        )
        const pprEnd = Date.now()

        this.pprTime += pprEnd - pprStart

        // Verify results
        if (pprSortedDocIds.length !== this.passageNodeIdxs.length) {
            this.ctx.logger.warn(
                `Doc prob length ${pprSortedDocIds.length} != corpus length ${this.passageNodeIdxs.length}`
            )
        }

        return [pprSortedDocIds, pprSortedDocScores]
    }

    /**
     * Reranks facts based on relevance to the query using LLM filtering
     *
     * @param query - The query string
     * @param queryFactScores - Similarity scores between query and facts
     * @returns Tuple of [top_k_fact_indices, top_k_facts, rerank_log]
     */
    private async rerankFacts(
        query: string,
        queryFactScores: number[],
        factNodeKeyToDoc: Map<string, Document>
    ): Promise<
        [
            number[],
            Triple[],
            {
                facts_before_rerank: Triple[]
                facts_after_rerank: Triple[]
            }
        ]
    > {
        // Load config values
        const linkTopK = this.globalConfig.linkingTopK

        // Check if there are any facts to rerank
        if (queryFactScores.length === 0 || this.factNodeKeys.length === 0) {
            this.ctx.logger.warn(
                'No facts available for reranking. Returning empty lists.'
            )
            return [[], [], { facts_before_rerank: [], facts_after_rerank: [] }]
        }

        // Get the top k facts by score
        let candidateFactIndices: number[]
        if (queryFactScores.length <= linkTopK) {
            // If we have fewer facts than requested, use all of them
            candidateFactIndices = queryFactScores
                .map((_, index) => index)
                .sort((a, b) => queryFactScores[b] - queryFactScores[a])
        } else {
            // Otherwise get the top k
            candidateFactIndices = queryFactScores
                .map((score, index) => ({ score, index }))
                .sort((a, b) => b.score - a.score)
                .slice(0, linkTopK)
                .map((item) => item.index)
        }

        // Get the actual fact content
        const candidateFacts: Triple[] = []
        for (const factIndex of candidateFactIndices) {
            if (factIndex >= 0 && factIndex < this.factNodeKeys.length) {
                const factNodeKey = this.factNodeKeys[factIndex]
                const factDoc = factNodeKeyToDoc.get(factNodeKey)

                if (factDoc) {
                    try {
                        const parsedFact = JSON.parse(factDoc.pageContent)
                        if (
                            Array.isArray(parsedFact) &&
                            parsedFact.length === 3
                        ) {
                            candidateFacts.push(parsedFact as Triple)
                        }
                    } catch (error) {
                        // Ignore parsing errors for now, or log them
                    }
                }
            }
        }

        if (candidateFacts.length === 0) {
            this.ctx.logger.warn('No valid facts found for reranking.')
            return [[], [], { facts_before_rerank: [], facts_after_rerank: [] }]
        }

        try {
            // Rerank the facts using the DSPy filter
            const [topKFactIndices, topKFacts, rerankLog] =
                await this.rerankFilter.rerank(
                    query,
                    candidateFacts,
                    candidateFactIndices,
                    linkTopK
                )

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return [topKFactIndices, topKFacts, rerankLog as any]
        } catch (error) {
            this.ctx.logger.error(`Error during fact reranking: ${error}`)
            this.ctx.logger.warn('Fact reranking failed, returning empty list.')
            return [
                [],
                [],
                {
                    facts_before_rerank: candidateFacts,
                    facts_after_rerank: []
                }
            ]
        }
    }

    /**
     * Runs Personalized PageRank on a graph and computes relevance scores for nodes
     */
    runPpr(resetProb: number[], damping: number = 0.5): [number[], number[]] {
        if (!damping) {
            damping = 0.5 // for potential compatibility
        }

        // Clean reset probabilities (replace NaN and negative values with 0)
        const cleanedResetProb = resetProb.map((val) =>
            isNaN(val) || val < 0 ? 0 : val
        )

        // Run personalized PageRank using the graph's implementation
        const pageRankScores = this.graph.personalizedPagerank({
            vertices: Array.from({ length: this.graph.vcount }, (_, i) => i),
            damping,
            directed: false,
            weights: 'weight',
            reset: cleanedResetProb,
            implementation: 'prpack'
        })

        // Extract scores for passage nodes only
        const docScores: number[] = []
        for (const passageIdx of this.passageNodeIdxs) {
            if (passageIdx < pageRankScores.length) {
                docScores.push(pageRankScores[passageIdx])
            } else {
                docScores.push(0) // fallback for invalid indices
            }
        }

        // Sort documents by scores in descending order
        const indexedScores = docScores.map((score, index) => ({
            score,
            index
        }))
        indexedScores.sort((a, b) => b.score - a.score)

        const sortedDocIds = indexedScores.map((item) => item.index)
        const sortedDocScores = indexedScores.map((item) => item.score)

        return [sortedDocIds, sortedDocScores]
    }

    // Helper methods for vector store operations

    /**
     * Insert strings into chunk embedding store
     */
    private async insertStringsToChunkStore(docs: Document[]): Promise<void> {
        const documents = docs.map((doc, index) => {
            const id = computeMDHashId(doc.pageContent, 'chunk-')
            doc.id = id
            doc.metadata = {
                id,
                ...(doc.metadata || {})
            }
            return doc
        })
        await this.chunkEmbeddingStore.addDocuments(documents)
    }

    /**
     * Insert strings into entity embedding store
     */
    private async insertStringsToEntityStore(
        entities: string[]
    ): Promise<void> {
        const documents = entities.map((entity, index) => {
            const entityId = computeMDHashId(entity, 'entity-')
            return {
                pageContent: entity,
                id: entityId,
                metadata: {
                    id: entityId,
                    content: entity
                }
            }
        })
        await this.entityEmbeddingStore.addDocuments(documents)
    }

    /**
     * Insert strings into fact embedding store
     */
    private async insertStringsToFactStore(facts: string[]): Promise<void> {
        const documents = facts.map((fact) => {
            const id = computeMDHashId(fact, 'fact-')
            return {
                id,
                pageContent: fact,
                metadata: { id, content: fact }
            }
        })
        await this.factEmbeddingStore.addDocuments(documents)
    }
}
