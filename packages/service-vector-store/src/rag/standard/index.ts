import { Context } from 'koishi'
import { Document } from '@langchain/core/documents'
import { BaseMessage } from '@langchain/core/messages'
import {
    AddDocumentsOptions,
    BaseRAGRetriever,
    DeleteDocumentsOptions,
    ListDocumentsOptions,
    RetrieverConfig,
    RetrieverStats,
    SearchOptions
} from '../base'
import { RetrievalContext, RetrievalStrategy, STRATEGIES } from './strategies'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

export class StandardRAGRetriever extends BaseRAGRetriever<StandardRAGRetrieverConfig> {
    private _strategy: RetrievalStrategy

    constructor(ctx: Context, config: StandardRAGRetrieverConfig) {
        super(ctx, config)

        this._strategy = config.retrievalType ?? 'fast'
    }

    async initialize(): Promise<void> {
        if (this._initialized && this._vectorStore?.checkActive(false)) return

        const config = this.config

        if (!config.vectorStoreKey) {
            throw new Error('vectorStoreKey is required')
        }

        this._vectorStore = await this.ctx.chatluna.platform.createVectorStore(
            this.ctx.chatluna.config.defaultVectorStore,
            {
                embeddings: this.config.embeddings,
                key: config.vectorStoreKey
            }
        )

        if (!this._vectorStore) {
            throw new Error(`Vector store not found: ${config.vectorStoreKey}`)
        }

        this._initialized = true
    }

    async addDocuments(
        documents: Document[],
        options?: AddDocumentsOptions
    ): Promise<string[]> {
        if (!this._initialized) await this.initialize()
        if (!this._vectorStore.checkActive(false)) await this.initialize()

        const batchSize = options?.batchSize ?? 30

        const results: string[] = []

        for (let i = 0; i < documents.length; i += batchSize) {
            const batch = documents.slice(i, i + batchSize)

            if (options?.metadata) {
                batch.forEach((doc) => {
                    doc.metadata = { ...doc.metadata, ...options.metadata }
                })
            }

            const batchIds = await this._vectorStore.addDocuments(batch, {
                ids: options?.ids?.slice(i, i + batchSize)
            })

            if (Array.isArray(batchIds)) {
                results.push(...batchIds)
            }
        }

        return results
    }

    async similaritySearch(
        query: string,
        options?: SearchOptions,
        history?: BaseMessage[]
    ): Promise<Document[]> {
        if (!this._initialized) await this.initialize()
        if (!this._vectorStore.checkActive(false)) await this.initialize()

        const config = this.config as StandardRAGRetrieverConfig
        const k = options?.k ?? this.config.maxResults ?? 5
        const threshold = options.threshold ?? 0.75

        // Validate LLM requirement for advanced strategies
        const llm = config.llm
        if (
            (this._strategy === 'regenerate' ||
                this._strategy === 'contextual-compression') &&
            !llm
        ) {
            throw new Error(`LLM is required for ${this._strategy} strategy`)
        }

        // Get initial search results for fast and contextual-compression
        const searchResults =
            this._strategy === 'regenerate'
                ? []
                : await this._vectorStore
                      .similaritySearchWithScore(query, k)
                      .then((results) =>
                          results.filter(([doc, score]) => score >= threshold)
                      )

        const context: RetrievalContext = {
            query,
            threshold,
            documents: searchResults.map(([doc]) => doc),
            history,
            llm,
            vectorStore: this._vectorStore,
            k
        }

        return await STRATEGIES[this._strategy](context)
    }

    async listDocuments(options?: ListDocumentsOptions): Promise<Document[]> {
        if (!this._initialized) await this.initialize()
        return []
    }

    async deleteDocuments(options: DeleteDocumentsOptions): Promise<void> {
        if (!this._initialized) await this.initialize()

        await this._vectorStore.delete({
            ids: options.ids,
            deleteAll: options.deleteAll
        })
    }

    async getStats(): Promise<RetrieverStats> {
        if (!this._initialized) await this.initialize()

        const docstore = this._vectorStore.docstore

        const stats = await docstore.stat()

        return {
            totalDocuments: stats.count,
            vectorStoreType: this._vectorStore.constructor.name,
            lastUpdated: stats.lastUpdated
        }
    }

    async dispose(): Promise<void> {
        if (this._vectorStore && typeof this._vectorStore.free === 'function') {
            await this._vectorStore.free()
        }
        this._initialized = false
    }

    setRetrievalType(strategy: RetrievalStrategy): void {
        this._strategy = strategy
    }

    getRetrievalType(): RetrievalStrategy {
        return this._strategy
    }
}

export interface StandardRAGRetrieverConfig extends RetrieverConfig {
    retrievalType?: RetrievalStrategy
    llm?: ChatLunaChatModel
}

export function createStandardRAGRetriever(
    ctx: Context,
    config: StandardRAGRetrieverConfig
): StandardRAGRetriever {
    return new StandardRAGRetriever(ctx, config)
}

export type { RetrievalStrategy } from './strategies'
