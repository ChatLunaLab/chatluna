import { VectorStore } from '@langchain/core/vectorstores'
import { Document, DocumentInterface } from '@langchain/core/documents'
import { EmbeddingsInterface } from '@langchain/core/embeddings'
import { DataBaseDocstore } from './database'
import {
    chunkArray,
    splitArray
} from 'koishi-plugin-chatluna/llm-core/utils/chunk'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { randomUUID } from 'node:crypto'

export abstract class ChatLunaSaveableVectorStore<
    T extends VectorStore = VectorStore
> extends VectorStore {
    private _isActive = true

    protected _store?: T

    protected _docstore?: DataBaseDocstore

    constructor(input: ChatLunaSaveableVectorStoreInput<T>) {
        super(input.embeddings, {})
        this._store = input.store
        this._docstore = input.docstore
    }

    async editDocument(oldDocumentId: string, newDocument: Document) {
        this.checkActive()

        // delete
        await this.delete({ ids: [oldDocumentId] })

        // add
        await this.addDocuments([newDocument])
    }

    async addVectors(
        vectors: number[][],
        documents: DocumentInterface[],
        options?: AddDocumentOptions
    ): Promise<string[] | void> {
        this.checkActive()

        const ids = await this._store.addVectors(vectors, documents, options)

        await this.save()

        return ids
    }

    async addDocuments(
        documents: DocumentInterface[],
        options?: AddDocumentOptions
    ): Promise<string[] | void> {
        this.checkActive()

        const ids = await this._store.addDocuments(documents, options)

        await this._docstore.add(
            Object.fromEntries(
                documents.map((document) => [
                    document.id || document.metadata['raw_id'] || randomUUID(),
                    document
                ])
            )
        )

        await this.save()

        return ids
    }

    similaritySearchVectorWithScore(
        query: number[],
        k: number,
        filter?: this['FilterType']
    ): Promise<[DocumentInterface, number][]> {
        if (query.length === 0) {
            throw new Error('Embedding dimension is 0')
        }

        return this._store.similaritySearchVectorWithScore(query, k, filter)
    }

    async save() {
        this.checkActive()
    }

    async delete(options: ChatLunaSaveableVectorDelete) {
        this.checkActive()

        const ids: string[] = []

        if (options.deleteAll) {
            await this._docstore.delete({ deleteAll: true })
            await this.save()
            return
        }

        if (options.ids) {
            ids.push(...options.ids)
        }

        if (options.documents) {
            const documentIds = options.documents
                ?.map((document) => {
                    return (
                        document.id ??
                        (document.metadata?.raw_id as string | undefined)
                    )
                })
                .filter((id) => id != null)

            ids.push(...documentIds)
        }

        if (!ids || ids.length === 0) return

        await this._docstore.delete({ ids })

        await this.save()
    }

    _vectorstoreType(): string {
        return this._store?._vectorstoreType() ?? 'chatluna'
    }

    async reIndex() {
        await this.delete({ deleteAll: true })

        const documents = await this.docstore.list()

        const chunkedArray = chunkArray(documents, 30)

        const chunkedPromise = splitArray(
            chunkedArray.map((chunk) => this.addDocuments(chunk)),
            6
        )

        for (const promise of chunkedPromise) {
            await Promise.all(promise)
        }
    }

    get docstore() {
        return this._docstore
    }

    checkActive(throwError: boolean = true) {
        if (!this._isActive && throwError) {
            throw new ChatLunaError(
                ChatLunaErrorCode.VECTOR_STORE_NOT_ACTIVE,
                Error('VectorStore is not active')
            )
        }
        return this._isActive
    }

    async free() {
        this._isActive = false
        this._store = undefined
        this._docstore = undefined
    }
}

export interface ChatLunaSaveableVectorStoreInput<
    T extends VectorStore = VectorStore
> {
    embeddings: EmbeddingsInterface
    docstore: DataBaseDocstore
    store: T
}

export interface ChatLunaSaveableVectorDelete
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extends Record<string, any> {
    deleteAll?: boolean
    documents?: Document[]
    ids?: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AddDocumentOptions = Record<string, any>
