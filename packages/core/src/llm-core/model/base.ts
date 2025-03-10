import { VectorStore } from '@langchain/core/vectorstores'
import { Document } from '@langchain/core/documents'

export class ChatLunaSaveableVectorStore<T extends VectorStore = VectorStore>
    extends VectorStore
    implements ChatLunaSaveableVectorStoreInput<T>
{
    saveableFunction: (store: T) => Promise<void>
    deletableFunction?: (
        store: T,
        input: ChatLunaSaveableVectorDelete
    ) => Promise<void>

    addDocumentsFunction?: (
        store: T,
        ...args: Parameters<T['addDocuments']>
    ) => Promise<void>

    similaritySearchVectorWithScoreFunction?: (
        store: T,
        ...args: Parameters<T['similaritySearchVectorWithScore']>
    ) => Promise<[Document, number][]>

    freeFunction?: () => Promise<void>

    private _isActive = true

    constructor(
        private _store: T,
        input: ChatLunaSaveableVectorStoreInput<T>
    ) {
        super(_store.embeddings, {})
        this.saveableFunction = input.saveableFunction ?? (async () => {})
        this.deletableFunction = input.deletableFunction
        this.addDocumentsFunction = input.addDocumentsFunction
        this.similaritySearchVectorWithScoreFunction =
            input.similaritySearchVectorWithScoreFunction
        this.freeFunction = input.freeFunction
    }

    addVectors(...args: Parameters<typeof this._store.addVectors>) {
        this.checkActive()
        if (args[0].length === 0 || args[0].some((v) => v.length === 0)) {
            throw new Error('Embedding dismension is 0')
        }
        return this._store.addVectors(...args)
    }

    addDocuments(...args: Parameters<T['addDocuments']>) {
        this.checkActive()
        if (this.addDocumentsFunction) {
            return this.addDocumentsFunction(this._store, ...args)
        }
        for (const document of args[0]) {
            if (document.pageContent.length === 0) {
                throw new Error('Document content is empty')
            }
        }
        return this._store.addDocuments(args[0], args[1])
    }

    similaritySearchVectorWithScore(
        ...args: Parameters<T['similaritySearchVectorWithScore']>
    ) {
        this.checkActive()
        if (args[0].length === 0) {
            throw new Error('Embedding dismension is 0')
        }

        if (this.similaritySearchVectorWithScoreFunction) {
            return this.similaritySearchVectorWithScoreFunction(
                this._store,
                ...args
            )
        }

        return this._store.similaritySearchVectorWithScore(
            args[0],
            args[1],
            args[2]
        )
    }

    async editDocument(oldDocumentId: string, newDocument: Document) {
        this.checkActive()

        // delete
        await this.delete({ ids: [oldDocumentId] })

        // add
        await (this as ChatLunaSaveableVectorStore<VectorStore>).addDocuments([
            newDocument
        ])
    }

    save() {
        this.checkActive()
        return this?.saveableFunction(this._store)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete(input: ChatLunaSaveableVectorDelete) {
        this.checkActive()
        return (
            this?.deletableFunction?.(this._store, input) ??
            this._store.delete(input)
        )
    }

    _vectorstoreType(): string {
        return this._store?._vectorstoreType() ?? '?'
    }

    checkActive(throwError: boolean = true) {
        if (!this._isActive && throwError) {
            throw new Error('VectorStore is not active')
        }
        return this._isActive
    }

    async free() {
        if (this.freeFunction) {
            await this.freeFunction()
        }
        this._store = undefined
        this._isActive = false
    }
}

export interface ChatLunaSaveableVectorStoreInput<T extends VectorStore> {
    saveableFunction?: (store: T) => Promise<void>
    deletableFunction?: (
        store: T,
        input: ChatLunaSaveableVectorDelete
    ) => Promise<void>
    addDocumentsFunction?: (
        store: T,
        ...args: Parameters<T['addDocuments']>
    ) => Promise<void>
    similaritySearchVectorWithScoreFunction?: (
        store: T,
        ...args: Parameters<T['similaritySearchVectorWithScore']>
    ) => Promise<[Document, number][]>
    freeFunction?: () => Promise<void>
}

export interface ChatLunaSaveableVectorDelete
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extends Record<string, any> {
    deleteAll?: boolean
    documents?: Document[]
    ids?: string[]
}
