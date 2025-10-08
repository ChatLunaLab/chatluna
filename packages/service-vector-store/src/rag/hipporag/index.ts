import { Context } from 'koishi'
import {
    AddDocumentsOptions,
    BaseRAGRetriever,
    DeleteDocumentsOptions,
    ListDocumentsOptions,
    RetrieverConfig,
    RetrieverStats,
    SearchOptions
} from '..'
import { Document } from '@langchain/core/documents'
import { BaseMessage } from '@langchain/core/messages'
import { HippoRAGConfig } from './config'
import { HippoRAG } from './hippo_rag'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { RemoveKey } from '../../utils'

export class HippoRAGRetriever extends BaseRAGRetriever<HippoRAGRetrieverConfig> {
    private _hippoRAG: HippoRAG

    constructor(ctx: Context, config: HippoRAGRetrieverConfig) {
        super(ctx, config)

        this._hippoRAG = new HippoRAG(
            ctx,
            Object.assign(
                {},
                {
                    embeddings: config.embeddings,
                    llm: config.llm,
                    key: config.vectorStoreKey
                },
                config.config
            )
        )
    }

    async initialize(): Promise<void> {
        await this._hippoRAG.initialize()
    }

    async addDocuments(
        documents: Document[],
        options?: AddDocumentsOptions
    ): Promise<string[]> {
        await this.initialize()

        documents = documents.map((doc, index) => {
            doc.metadata = {
                ...doc.metadata,
                ...options?.metadata
            }

            doc.id = doc.id ?? doc.metadata.id ?? options?.ids?.[index]

            return doc
        })

        await this._hippoRAG.index(documents)

        return documents.map((doc) => doc.id)
    }

    async similaritySearch(
        query: string,
        options?: SearchOptions,
        history?: BaseMessage[]
    ): Promise<Document[]> {
        await this.initialize()

        return await this._hippoRAG
            .retrieve([query], options.k ?? 10)
            .then((solutions) => solutions.flatMap((solution) => solution.docs))
    }

    async listDocuments(options?: ListDocumentsOptions): Promise<Document[]> {
        await this.initialize()

        return await this._hippoRAG.chunkEmbeddingStore.docstore.list(options)
    }

    async deleteDocuments(options: DeleteDocumentsOptions): Promise<void> {
        if (options.deleteAll === true) {
            const documents =
                await this._hippoRAG.chunkEmbeddingStore.docstore.list()
            return await this._hippoRAG.delete(
                documents.map(
                    (doc) => doc.id || doc.metadata.id || doc.metadata['raw_id']
                )
            )
        }

        return await this._hippoRAG.delete(options.ids)
    }

    async getStats(): Promise<RetrieverStats> {
        const stats = this._hippoRAG.getGraphInfo()
        return {
            totalDocuments: 0,
            vectorStoreType: 'hippo',
            ...stats
        }
    }

    async dispose(): Promise<void> {
        this._hippoRAG = undefined
    }
}

export interface HippoRAGRetrieverConfig extends RetrieverConfig {
    llm: ChatLunaChatModel
    config: RemoveKey<HippoRAGConfig, 'llm' | 'embeddings'>
}

export function createHippoRAGRetriever(
    ctx: Context,
    config: HippoRAGRetrieverConfig
): HippoRAGRetriever {
    return new HippoRAGRetriever(ctx, config)
}

export * from './hippo_rag'
export * from './config'
