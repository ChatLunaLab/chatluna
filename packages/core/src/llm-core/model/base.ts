import { VectorStore } from 'langchain/vectorstores/base'
import { Document } from 'langchain/document'

export class ChatLunaSaveableVectorStore<T extends VectorStore>
    extends VectorStore
    implements ChatLunaSaveableVectorStoreInput<T>
{
    saveableFunction: (store: T) => Promise<void>
    deletableFunction: (store: T) => Promise<void>

    constructor(
        private _store: T,
        input: ChatLunaSaveableVectorStoreInput<T>
    ) {
        super(_store.embeddings, {})
        this.saveableFunction = input.saveableFunction ?? (async () => {})
        this.deletableFunction = input.deletableFunction ?? (async () => {})
    }

    addVectors(vectors: number[][], documents: Document[]) {
        return this._store.addVectors(vectors, documents)
    }

    addDocuments(documents: Document[]) {
        return this._store.addDocuments(documents)
    }

    similaritySearchVectorWithScore(
        query: number[],
        k: number,
        filter?: this['FilterType']
    ) {
        return this._store.similaritySearchVectorWithScore(query, k, filter)
    }

    save() {
        return this.saveableFunction(this._store)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete(_params?: Record<string, any>): Promise<void> {
        return this.deletableFunction(this._store)
    }

    _vectorstoreType(): string {
        return this._store?._vectorstoreType() ?? '?'
    }
}

export interface ChatLunaSaveableVectorStoreInput<T> {
    saveableFunction?: (store: T) => Promise<void>
    deletableFunction?: (store: T) => Promise<void>
}
