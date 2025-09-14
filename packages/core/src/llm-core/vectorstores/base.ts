import { VectorStore } from '@langchain/core/vectorstores'
import { Document, DocumentInterface } from '@langchain/core/documents'
import { EmbeddingsInterface } from '@langchain/core/embeddings'
import { DataBaseDocstore } from './database'

export abstract class ChatLunaSaveableVectorStore<
    T extends VectorStore = VectorStore
> extends VectorStore {
    private _isActive = true

    private _store: T

    constructor(input: ChatLunaSaveableVectorStoreInput<T>) {
        super(input.embeddings, {})
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async delete(input: ChatLunaSaveableVectorDelete) {
        this.checkActive()
    }

    _vectorstoreType(): string {
        return this._store?._vectorstoreType() ?? 'chatluna'
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
