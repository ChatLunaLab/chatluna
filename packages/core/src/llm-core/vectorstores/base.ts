import { VectorStore } from '@langchain/core/vectorstores'
import { Document, DocumentInterface } from '@langchain/core/documents'
import { EmbeddingsInterface } from '@langchain/core/embeddings'
import { DataBaseDocstore } from './database'
import {
    chunkArray,
    splitArray
} from 'koishi-plugin-chatluna/llm-core/utils/chunk'

export abstract class ChatLunaSaveableVectorStore<
    T extends VectorStore = VectorStore
> extends VectorStore {
    private _isActive = true

    private _store: T

    private _docstore: DataBaseDocstore

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

    addVectors(
        vectors: number[][],
        documents: DocumentInterface[],
        options?: AddDocumentOptions
    ): Promise<string[] | void> {
        this.checkActive()

        return this._store.addVectors(vectors, documents, options)
    }

    addDocuments(
        documents: DocumentInterface[],
        options?: AddDocumentOptions
    ): Promise<string[] | void> {
        this.checkActive()

        return this._store.addDocuments(documents, options)
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

    save() {
        this.checkActive()
    }

    async delete(input: ChatLunaSaveableVectorDelete) {
        this.checkActive()
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

        await Promise.all(chunkedPromise)
    }

    get docstore() {
        return this._docstore
    }

    checkActive(throwError: boolean = true) {
        if (!this._isActive && throwError) {
            throw new Error('VectorStore is not active')
        }
        return this._isActive
    }

    async free() {
        this._isActive = false
        this._store = undefined
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
type AddDocumentOptions = Record<string, any>
