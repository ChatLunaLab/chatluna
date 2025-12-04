import { VectorStore } from '@langchain/core/vectorstores'
import { Document, DocumentInterface } from '@langchain/core/documents'
import { EmbeddingsInterface } from '@langchain/core/embeddings'
import { DataBaseDocstore } from './database'
export declare abstract class ChatLunaSaveableVectorStore<
    T extends VectorStore = VectorStore
> extends VectorStore {
    private _isActive
    protected _store?: T
    protected _docstore?: DataBaseDocstore
    constructor(input: ChatLunaSaveableVectorStoreInput<T>)
    editDocument(oldDocumentId: string, newDocument: Document): Promise<void>
    addVectors(
        vectors: number[][],
        documents: DocumentInterface[],
        options?: AddDocumentOptions
    ): Promise<string[] | void>

    addDocuments(
        documents: DocumentInterface[],
        options?: AddDocumentOptions
    ): Promise<string[] | void>

    similaritySearchVectorWithScore(
        query: number[],
        k: number,
        filter?: this['FilterType']
    ): Promise<[DocumentInterface, number][]>

    save(): Promise<void>
    delete(options: ChatLunaSaveableVectorDelete): Promise<void>
    _vectorstoreType(): string
    reIndex(): Promise<void>
    get docstore(): DataBaseDocstore
    checkActive(throwError?: boolean): boolean
    free(): Promise<void>
}
export interface ChatLunaSaveableVectorStoreInput<
    T extends VectorStore = VectorStore
> {
    embeddings: EmbeddingsInterface
    docstore: DataBaseDocstore
    store: T
}
export interface ChatLunaSaveableVectorDelete extends Record<string, any> {
    deleteAll?: boolean
    documents?: Document[]
    ids?: string[]
}
export type AddDocumentOptions = Record<string, any>
