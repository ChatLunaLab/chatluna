import { VectorStore } from 'langchain/vectorstores/base'
import { Document } from 'langchain/document'

export class ChatHubSaveableVectorStore<T extends VectorStore> extends VectorStore {
    constructor(
        private _store: T,
        private _saveableFunction: (store: T) => Promise<void>
    ) {
        super(_store.embeddings, {})
    }

    addVectors(vectors: number[][], documents: Document[]) {
        return this._store.addVectors(vectors, documents)
    }

    addDocuments(documents: Document[]) {
        return this._store.addDocuments(documents)
    }

    similaritySearchVectorWithScore(query: number[], k: number, filter?: this['FilterType']) {
        return this._store.similaritySearchVectorWithScore(query, k, filter)
    }

    save() {
        return this._saveableFunction(this._store)
    }

    _vectorstoreType(): string {
        return this._store?._vectorstoreType() ?? '?'
    }
}
