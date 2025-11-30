import { VectorStoreRetriever } from '@langchain/core/vectorstores'
import { Config, logger } from '../..'
import { ScoreThresholdRetriever } from 'koishi-plugin-chatluna/llm-core/retrievers'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import path from 'path'
import { Context } from 'koishi'
import {
    EnhancedMemory,
    MemoryRetrievalLayerInfo,
    MemoryRetrievalLayerType
} from '../../types'
import { BaseMemoryRetrievalLayer } from '../../utils/layer'
import {
    documentToEnhancedMemory,
    enhancedMemoryToDocument,
    isMemoryExpired
} from '../../utils/memory'
import {
    computeSimHashHex,
    filterSimilarMemoryByVectorStore,
    scoreHumanLikeRecall
} from '../../utils/similarity'
import { extractTriples } from './ie'
import { HippoGraphIndex } from './kg'
import { Document } from '@langchain/core/documents'
import * as fs from 'fs/promises'
import { ComputedRef } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

// Standard vector store-based memory retrieval layer
export class HippoRAGMemoryLayer<
    T extends MemoryRetrievalLayerType = MemoryRetrievalLayerType
> extends BaseMemoryRetrievalLayer<T> {
    private kgIndex: HippoGraphIndex
    private simhashDocCache: Map<string, Document> = new Map()

    private extractModel: ComputedRef<ChatLunaChatModel>

    constructor(
        protected ctx: Context,
        protected config: Config,
        public info: Required<MemoryRetrievalLayerInfo<T>>
    ) {
        super(ctx, config, info)

        ctx.setInterval(
            async () => {
                await this.cleanupExpiredMemories()
            },
            1000 * 60 * 10
        )

        this.kgIndex = new HippoGraphIndex()
    }

    private getKGFilePath(): string {
        const base = this.ctx.baseDir ?? process.cwd()
        return path.join(
            base,
            'data/chatluna/long-memory/hippo',
            `${this.info.memoryId}.json`
        )
    }

    private async saveKG(): Promise<void> {
        if (!this.config.hippoKGPersist) return
        try {
            const file = this.getKGFilePath()
            await fs.mkdir(path.dirname(file), { recursive: true })
            await fs.writeFile(
                file,
                JSON.stringify(this.kgIndex.toJSON()),
                'utf-8'
            )
        } catch (e) {
            logger?.debug('saveKG failed', e)
        }
    }

    private async loadKG(): Promise<boolean> {
        if (!this.config.hippoKGPersist) return false
        try {
            const file = this.getKGFilePath()
            const buf = await fs.readFile(file, 'utf-8')
            this.kgIndex = HippoGraphIndex.fromJSON(JSON.parse(buf))
            const alias = this.config.hippoAliasThreshold
            if (alias != null) this.kgIndex.consolidateAliases(alias)
            return true
        } catch {
            return false
        }
    }

    private async rebuildIndex(limit = 1000): Promise<void> {
        if (!this.vectorStore || !this.vectorStore.checkActive(false)) {
            await this.initialize()
        }

        this.simhashDocCache.clear()
        // Try load persisted KG first
        const loaded = await this.loadKG()
        if (!loaded) {
            this.kgIndex = new HippoGraphIndex()
        }
        try {
            const MAX_LIST_LIMIT = 10000
            const allDocs = await this.vectorStore.docstore.list({
                limit: Math.min(limit, MAX_LIST_LIMIT)
            })
            // TODO: If the underlying docstore supports pagination/cursors,
            // replace the single list call with batched/streamed reads to iterate in pages
            // to reduce peak memory and time
            for (const d of allDocs) {
                const simhash: string =
                    (d.metadata?.simhash as string) ||
                    computeSimHashHex(d.pageContent)
                d.metadata = { ...d.metadata, simhash }
                // Always refresh doc cache
                this.simhashDocCache.set(simhash, d)
                if (!loaded) {
                    // Build KG only when not loaded from disk
                    this.kgIndex.addMemory(d.pageContent, simhash)
                    // optional bridging
                    const bridge = this.config.hippoBridgeThreshold ?? undefined
                    if (bridge != null) {
                        const ents = this.kgIndex.extractEntities(d.pageContent)
                        this.kgIndex.addBridgesForEntities(ents, bridge)
                    }
                    // optional IE triples -> relation edges
                    if (this.config.hippoIEEnabled) {
                        try {
                            const triples = await extractTriples(
                                this.extractModel,
                                d.pageContent
                            )
                            for (const t of triples) {
                                if (t.subject && t.object)
                                    this.kgIndex.addRelationEdge(
                                        t.subject,
                                        t.object,
                                        2
                                    )
                            }
                        } catch {}
                    }
                }
            }
            if (!loaded) {
                const alias = this.config.hippoAliasThreshold
                if (alias != null) this.kgIndex.consolidateAliases(alias)
                await this.saveKG()
            }
        } catch (e) {
            logger?.debug('rebuildIndex failed', e)
        }
    }

    // Admin/inspection APIs
    public async rebuildKGIndex(): Promise<void> {
        await this.rebuildIndex(1000)
    }

    public getKGStats(): { entities: number; edges: number } {
        return this.kgIndex.getStats()
    }

    public getNeighbors(
        entity: string,
        k = 10
    ): { entity: string; weight: number }[] {
        const row = this.kgIndex.getNeighborMap(entity)
        if (!row) return []
        return Array.from(row.entries())
            .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
            .slice(0, Math.max(1, k))
            .map(([e, w]) => ({ entity: e, weight: w }))
    }

    async initialize(): Promise<void> {
        const { type: layerType, memoryId, userId } = this.info

        logger?.info(
            `init layer(${layerType}) ${memoryId} for ${userId != null ? `user ${userId}` : `global`}`
        )

        this.retriever = await createVectorStoreRetriever(
            this.ctx,
            this.config,
            memoryId
        )
        this.vectorStore = this.retriever.vectorStore

        this.extractModel = await this.ctx.chatluna.createChatModel(
            this.config.hippoExtractModel
        )

        await this.rebuildIndex(1000)
    }

    async retrieveMemory(searchContent: string): Promise<EnhancedMemory[]> {
        // 检查向量存储是否初始化
        if (!this.vectorStore || !this.vectorStore.checkActive(false)) {
            await this.initialize()
        }

        let memory: Document[] = []
        try {
            memory = await this.retriever.invoke(searchContent)
        } catch (e) {
            logger.error('Failed to retrieve memory from vector store', e)
            return []
        }

        // HippoRAG KG candidate expansion via PPR (always enabled)
        let byKey = new Map<string, Document>()
        const seeds = this.kgIndex.seedsFromQuery(searchContent)
        const ppr = this.kgIndex.ppr(
            seeds,
            this.config.hippoPPRAlpha ?? 0.15
        ) as Map<string, number>
        const kgCandidates = this.kgIndex.getCandidatesByPPR(
            ppr as Map<string, number>,
            this.config.hippoTopEntities ?? 10,
            this.config.hippoMaxCandidates ?? 200
        )
        const kgDocs: Document[] = []
        for (const key of kgCandidates) {
            const d = this.simhashDocCache.get(key)
            if (d) kgDocs.push(d)
        }

        // merge candidates from vector store and KG
        byKey = new Map<string, Document>()
        const put = (d: Document) => {
            const simhash: string =
                (d.metadata?.simhash as string) ||
                computeSimHashHex(d.pageContent)
            d.metadata = { ...d.metadata, simhash }
            byKey.set(simhash, d)
        }
        for (const d of memory) put(d)
        for (const d of kgDocs) put(d)

        // re-ranking
        const qHash = computeSimHashHex(searchContent)
        const scored = Array.from(byKey.values())
            .map((doc) => {
                const human = scoreHumanLikeRecall(searchContent, doc, {
                    querySimHashHex: qHash
                }).score
                let final = human
                if (ppr) {
                    const pprScore = this.kgIndex.scoreContentByPPR(
                        doc.pageContent,
                        ppr as Map<string, number>
                    )
                    const w = this.config.hippoHybridWeight ?? 0.8
                    final = w * human + (1 - w) * pprScore
                }
                return { doc, score: final }
            })
            .sort((a, b) => b.score - a.score)

        const threshold = this.config.hippoSimilarityThreshold ?? 0
        const filtered =
            threshold > 0 ? scored.filter((s) => s.score >= threshold) : scored

        try {
            const topK = this.config.hippoReinforceTopK ?? 10
            const docs = filtered.slice(0, Math.max(1, topK)).map((s) => s.doc)

            if (docs.length > 0) {
                const nowISO = new Date().toISOString()
                for (const d of docs) {
                    const meta = d.metadata ?? {}
                    meta.last_accessed = nowISO
                    meta.access_count = Number(meta.access_count ?? 0) + 1
                    d.metadata = meta
                    // keep cache in sync
                    const key: string =
                        (meta.simhash as string) ||
                        computeSimHashHex(d.pageContent)
                    this.simhashDocCache.set(key, d)
                }

                for (const d of docs) {
                    await this.vectorStore.editDocument(d.id, d)
                }

                try {
                    await this.vectorStore.save()
                } catch (e) {
                    logger?.debug('save after access update failed', e)
                }
            }
        } catch (e) {
            logger?.debug('update access stats failed', e)
        }

        return filtered.map((s) => documentToEnhancedMemory(s.doc, this.info))
    }

    async addMemories(memories: EnhancedMemory[]): Promise<void> {
        if (!this.vectorStore) {
            logger?.warn('Vector store not initialized')
            return
        }

        // Simple duplicate check using vector store with fixed threshold
        memories = await filterSimilarMemoryByVectorStore(
            memories,
            this.vectorStore,
            0.8
        )

        if (memories.length === 0) return

        const docs = memories.map(enhancedMemoryToDocument)
        await this.vectorStore.addDocuments(docs)

        // Update KG and cache
        for (const d of docs) {
            const simhash: string =
                (d.metadata?.simhash as string) ||
                computeSimHashHex(d.pageContent)
            d.metadata = { ...d.metadata, simhash }
            this.kgIndex.addMemory(d.pageContent, simhash)
            this.simhashDocCache.set(simhash, d)
            // optional bridging on new content
            const bridge = this.config.hippoBridgeThreshold ?? undefined
            if (bridge != null) {
                const ents = this.kgIndex.extractEntities(d.pageContent)
                this.kgIndex.addBridgesForEntities(ents, bridge)
            }
            const alias = this.config.hippoAliasThreshold
            if (alias != null) this.kgIndex.consolidateAliases(alias)
        }

        await this.saveKG()

        if (this.vectorStore instanceof ChatLunaSaveableVectorStore) {
            logger?.debug('saving vector store')
            try {
                await this.vectorStore.save()
            } catch (e) {
                logger.error(e)
            }
        }
    }

    async clearMemories(): Promise<void> {
        if (!this.vectorStore || !this.vectorStore.checkActive(false)) {
            await this.initialize()
        }

        await this.vectorStore.delete({ deleteAll: true })
        // also clear KG/cache
        this.kgIndex = new HippoGraphIndex()
        this.simhashDocCache.clear()
        await this.saveKG()
    }

    async deleteMemories(memoryIds: string[]): Promise<void> {
        // 删除指定ID的记忆
        await this.vectorStore.delete({ ids: memoryIds })

        // 保存向量存储
        if (this.vectorStore instanceof ChatLunaSaveableVectorStore) {
            await this.vectorStore.save()
        }

        logger?.debug(`Deleted ${memoryIds.length} expired memories`)

        try {
            for (const [key, d] of Array.from(this.simhashDocCache.entries())) {
                if (d.id && memoryIds.includes(d.id)) {
                    this.kgIndex.removeMemoryBySimhash(key)
                    this.simhashDocCache.delete(key)
                }
            }
        } catch (e) {
            logger?.debug('failed to update KG/cache after delete', e)
        }
        await this.saveKG()
    }

    public async explainRetrieve(
        searchContent: string,
        opts?: { topEntities?: number; topDocs?: number }
    ): Promise<unknown> {
        const topEntities =
            opts?.topEntities ?? this.config.hippoTopEntities ?? 10
        const topDocs = opts?.topDocs ?? 10
        const seeds = this.kgIndex.seedsFromQuery(searchContent)
        const ppr = this.kgIndex.ppr(seeds, this.config.hippoPPRAlpha ?? 0.15)
        const sortedEntities = Array.from(ppr.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, Math.max(1, topEntities))

        const kgCandidates = this.kgIndex.getCandidatesByPPR(
            ppr,
            topEntities,
            this.config.hippoMaxCandidates ?? 200
        )
        const kgDocs: Document[] = []
        for (const key of kgCandidates) {
            const d = this.simhashDocCache.get(key)
            if (d) kgDocs.push(d)
        }

        const vectorDocs = await this.retriever.invoke(searchContent)
        const qHash = computeSimHashHex(searchContent)

        const byKey = new Map<string, Document>()
        const put = (d: Document) => {
            const simhash: string =
                (d.metadata?.simhash as string) ||
                computeSimHashHex(d.pageContent)
            d.metadata = { ...d.metadata, simhash }
            byKey.set(simhash, d)
        }
        for (const d of vectorDocs) put(d)
        for (const d of kgDocs) put(d)

        const details = Array.from(byKey.values())
            .map((doc) => {
                const human = scoreHumanLikeRecall(searchContent, doc, {
                    querySimHashHex: qHash
                })
                const pprScore = this.kgIndex.scoreContentByPPR(
                    doc.pageContent,
                    ppr
                )
                const w = this.config.hippoHybridWeight ?? 0.8
                const final = w * human.score + (1 - w) * pprScore
                return {
                    doc: {
                        id: doc.id ?? null,
                        simhash: doc.metadata?.simhash ?? null,
                        contentPreview: doc.pageContent.slice(0, 200)
                    },
                    scores: {
                        human,
                        ppr: pprScore,
                        final
                    }
                }
            })
            .sort((a, b) => b.scores.final - a.scores.final)
            .slice(0, Math.max(1, topDocs))

        return {
            config: {
                hippoHybridWeight: this.config.hippoHybridWeight,
                hippoSimilarityThreshold: this.config.hippoSimilarityThreshold,
                hippoPPRAlpha: this.config.hippoPPRAlpha
            },
            seeds,
            topEntities: sortedEntities,
            results: details
        }
    }

    async cleanupExpiredMemories(): Promise<void> {
        if (!this.vectorStore) {
            return
        }

        if (!this.vectorStore.checkActive(false)) {
            await this.initialize()
        }

        try {
            // 获取所有记忆
            const allMemories = await this.vectorStore.docstore.list({
                limit: 10000
            })

            // 找出过期的记忆
            const expiredMemoriesIds: string[] = []

            for (const doc of allMemories) {
                const memory = documentToEnhancedMemory(doc, this.info)
                if (isMemoryExpired(memory) && doc.id) {
                    expiredMemoriesIds.push(doc.id)
                }
            }

            if (expiredMemoriesIds.length > 0) {
                logger?.info(
                    `Found ${expiredMemoriesIds.length} expired memories to delete`
                )

                await this.deleteMemories(expiredMemoriesIds)
            }
        } catch (e) {
            logger?.error(`Error cleaning up expired memories`, e)
        }
    }
}

export async function createVectorStoreRetriever(
    ctx: Context,
    config: Config,
    longMemoryId: string
): Promise<VectorStoreRetriever<ChatLunaSaveableVectorStore>> {
    const [platform, model] = parseRawModelName(
        ctx.chatluna.config.defaultEmbeddings
    )
    const embeddingRef = await ctx.chatluna.createEmbeddings(platform, model)
    const embeddingModel = embeddingRef.value

    const vectorStore = await ctx.chatluna.platform.createVectorStore(
        ctx.chatluna.config.defaultVectorStore,
        {
            embeddings: embeddingModel,
            key: longMemoryId
        }
    )

    const retriever = ScoreThresholdRetriever.fromVectorStore(vectorStore, {
        minSimilarityScore: Math.max(
            0,
            Math.min(0.1, (config.hippoSimilarityThreshold ?? 0.35) - 0.3)
        ), // Finds results with at least this similarity score
        maxK: 50, // The maximum K value to use. Use it based to your chunk size to make sure you don't run out of tokens
        kIncrement: 2, // How much to increase K by each time. It'll fetch N results, then N + kIncrement, then N + kIncrement * 2, etc.,
        searchType: 'mmr'
    })

    return retriever
}
