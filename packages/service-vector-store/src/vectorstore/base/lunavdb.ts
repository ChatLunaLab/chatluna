import { LunaVDB as LunaDB } from '@chatluna/luna-vdb'
import type { EmbeddingsInterface } from '@langchain/core/embeddings'
import { SaveableVectorStore } from '@langchain/core/vectorstores'
import { Document, DocumentInterface } from '@langchain/core/documents'
import { SynchronousInMemoryDocstore } from '@langchain/community/stores/doc/in_memory'
import crypto from 'crypto'
import {
    ChatLunaSaveableVectorDelete,
    ChatLunaSaveableVectorStore,
    ChatLunaSaveableVectorStoreInput
} from 'koishi-plugin-chatluna/llm-core/vectorstores'
import fs from 'fs/promises'

export interface LunaVDBLibArgs {
    docstore?: SynchronousInMemoryDocstore
}

/**
 * Class that extends `VectorStore`. It allows to perform similarity search using
 * Voi similarity search engine. The class requires passing LunaVDB Client as an input parameter.
 */
export class LunaDBVectorStore extends SaveableVectorStore {
    client: LunaDB

    docstore: SynchronousInMemoryDocstore

    getDocstore(): SynchronousInMemoryDocstore {
        return this.docstore
    }

    _vectorstoreType(): string {
        return 'luna-db'
    }

    constructor(
        client: LunaDB,
        embeddings: EmbeddingsInterface,
        args?: LunaVDBLibArgs
    ) {
        super(embeddings, {})
        this.client = client
        this.embeddings = embeddings
        this.docstore = args?.docstore ?? new SynchronousInMemoryDocstore()
    }

    /**
     * Adds documents to the Voy database. The documents are embedded using embeddings provided while instantiating the class.
     * @param documents An array of `Document` instances associated with the vectors.
     */
    async addDocuments(
        documents: Document[],
        options?: { ids?: string[] }
    ): Promise<void> {
        const texts = documents.map(({ pageContent }) => pageContent)
        if (documents.length === 0) {
            return
        }

        const restResults = await this.embeddings.embedDocuments(texts)
        await this.addVectors(restResults, documents, options)
    }

    /**
     * Adds vectors to the Voy database. The vectors are associated with
     * the provided documents.
     * @param vectors An array of vectors to be added to the database.
     * @param documents An array of `Document` instances associated with the vectors.
     */
    async addVectors(
        vectors: number[][],
        documents: Document[],
        options?: { ids?: string[] }
    ): Promise<string[]> {
        if (vectors.length === 0) {
            return []
        }

        if (vectors.length !== documents.length) {
            throw new Error(`Vectors and metadata must have the same length`)
        }

        const documentIds =
            options?.ids ?? documents.map(() => crypto.randomUUID())

        const embeddings = documentIds.map((documentId, idx) => {
            const resource = { id: documentId, embeddings: vectors[idx] }
            this.docstore.add({ [documentId]: documents[idx] })
            return resource
        })
        this.client.add({ embeddings })
        return documentIds
    }

    /**
     * Searches for vectors in the Voy database that are similar to the
     * provided query vector.
     * @param query The query vector.
     * @param k The number of similar vectors to return.
     * @returns A promise that resolves with an array of tuples, each containing a `Document` instance and a similarity score.
     */
    async similaritySearchVectorWithScore(query: number[], k: number) {
        const docStoreSize = this.docstore._docs.size
        const itemsToQuery = Math.min(docStoreSize, k)
        if (k > docStoreSize) {
            console.warn(
                `k (${k}) is greater than the number of elements in the index (${docStoreSize}), setting k to ${itemsToQuery}`
            )
        }
        const results = this.client.search(
            new Float32Array(query),
            itemsToQuery
        )
        return results.neighbors.map(({ id, distance }) => {
            return [this.docstore.search(id), distance] as [Document, number]
        })
    }

    /**
     * Method to delete data from the Voy index. It can delete data based
     * on specific IDs or a filter.
     * @param params Object that includes either an array of IDs or a filter for the data to be deleted.
     * @returns Promise that resolves when the deletion is complete.
     */
    async delete(params: {
        deleteAll?: boolean
        ids?: string[]
    }): Promise<void> {
        if (params.deleteAll === true) {
            this.client.clear()
            this.docstore._docs.clear()
            return
        }

        const documentIds = params.ids

        if (documentIds == null || documentIds.length < 1) {
            throw new Error('No documentIds provided to delete.')
        }

        const mappingIds = Array.from(this.docstore._docs.keys())

        const missingIds = documentIds.filter((id) => !mappingIds.includes(id))

        if (missingIds.length > 0) {
            throw new Error(
                `Some specified documentIds do not exist in the current store. DocumentIds not found: ${Array.from(
                    missingIds
                ).join(', ')}`
            )
        }

        const embeddings = documentIds.map((id) => {
            this.docstore._docs.delete(id)
            return id
        })

        this.client.remove(embeddings)
    }

    /**
     * Loads a VoyStore from a specified directory.
     * @param directory The directory to load the VoyStore from.
     * @param embeddings An Embeddings object.
     * @returns A Promise that resolves with a new VoyStore instance.
     */
    static async load(directory: string, embeddings: EmbeddingsInterface) {
        const fs = await import('node:fs/promises')
        const path = await import('node:path')
        const readStore = (directory: string) =>
            fs
                .readFile(path.join(directory, 'docstore.json'), 'utf-8')
                .then(JSON.parse) as Promise<[string, Document][]>

        const readIndex = async (directory: string) => {
            const data = await fs.readFile(
                path.join(directory, 'luna_db.index')
            )

            return LunaDB.deserialize(data)
        }
        const [docstoreFiles, index] = await Promise.all([
            readStore(directory),
            readIndex(directory)
        ])
        const docstore = new SynchronousInMemoryDocstore(new Map(docstoreFiles))
        return new this(index, embeddings, { docstore })
    }

    /**
     * Saves the current state of the VoyStore to a specified directory.
     * @param directory The directory to save the state to.
     * @returns A Promise that resolves when the state has been saved.
     */
    async save(directory: string) {
        const fs = await import('node:fs/promises')
        const path = await import('node:path')
        await fs.mkdir(directory, { recursive: true })
        await Promise.all([
            await fs.writeFile(
                path.join(directory, 'luna_db.index'),
                this.client.serialize()
            ),
            await fs.writeFile(
                path.join(directory, 'docstore.json'),
                JSON.stringify(Array.from(this.docstore._docs.entries()))
            )
        ])
    }

    /**
     * Creates a new `VoyVectorStore` instance from an array of text strings. The text
     * strings are converted to `Document` instances and added to the Voy
     * database.
     * @param texts An array of text strings.
     * @param metadatas An array of metadata objects or a single metadata object. If an array is provided, it must have the same length as the `texts` array.
     * @param embeddings An `Embeddings` instance used to generate embeddings for the documents.
     * @param client An instance of Voy client to use in the underlying operations.
     * @returns A promise that resolves with a new `VoyVectorStore` instance.
     */
    static async fromTexts(
        texts: string[],
        metadatas: object[] | object,
        embeddings: EmbeddingsInterface,
        client: LunaDB,
        options?: LunaVDBLibArgs
    ): Promise<LunaDBVectorStore> {
        const docs: Document[] = []
        for (let i = 0; i < texts.length; i += 1) {
            const metadata = Array.isArray(metadatas) ? metadatas[i] : metadatas
            const newDoc = new Document({ pageContent: texts[i], metadata })
            docs.push(newDoc)
        }
        return LunaDBVectorStore.fromDocuments(
            docs,
            embeddings,
            client,
            options
        )
    }

    /**
     * Creates a new `VoyVectorStore` instance from an array of `Document` instances.
     * The documents are added to the Voy database.
     * @param docs An array of `Document` instances.
     * @param embeddings An `Embeddings` instance used to generate embeddings for the documents.
     * @param client An instance of Voy client to use in the underlying operations.
     * @returns A promise that resolves with a new `VoyVectorStore` instance.
     */
    static async fromDocuments(
        docs: Document[],
        embeddings: EmbeddingsInterface,
        client: LunaDB,
        options?: LunaVDBLibArgs
    ): Promise<LunaDBVectorStore> {
        const instance = new LunaDBVectorStore(client, embeddings, options)
        await instance.addDocuments(docs)
        return instance
    }
}

export class LunaVectorStore extends ChatLunaSaveableVectorStore<LunaDBVectorStore> {
    private _directory: string
    constructor(input: LunaVectorStoreInput) {
        super(input)
        this._directory = input.directory
    }

    addDocuments(
        documents: DocumentInterface[],
        options?: Parameters<LunaDBVectorStore['addDocuments']>[1]
    ): Promise<string[] | void> {
        let ids = options?.ids ?? []

        ids = documents.map((document, i) => {
            const id = ids[i] ?? document.id ?? crypto.randomUUID()

            document.id = id

            return id
        })

        return super.addDocuments(documents, {
            ...options,
            ids
        })
    }

    async delete(options: ChatLunaSaveableVectorDelete): Promise<void> {
        if (options.deleteAll) {
            await fs.rm(this._directory, { recursive: true })
            await this._store.delete({ deleteAll: true })
            return
        }

        const ids: string[] = []

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

        if (ids.length > 0) {
            await this._store.delete({ ids })
        }

        await super.delete(options)
    }

    async save() {
        await this._store.save(this._directory)
    }

    free(): Promise<void> {
        this._store.client.free()
        return super.free()
    }
}

export interface LunaVectorStoreInput
    extends ChatLunaSaveableVectorStoreInput<LunaDBVectorStore> {
    directory: string
}
