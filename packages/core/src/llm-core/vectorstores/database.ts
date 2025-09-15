import { Document } from '@langchain/core/documents'
import { Context } from 'koishi'

/**
 * Class for storing and retrieving documents in memory synchronously.
 */
export class DataBaseDocstore {
    constructor(
        private ctx: Context,
        private key: string
    ) {}

    /**
     * Searches for a document in the store based on its ID.
     * @param search The ID of the document to search for.
     * @returns The document with the given ID.
     */
    async get(search: string): Promise<Document> {
        const document = await this.ctx.database.get('chatluna_docstore', {
            key: this.key,
            id: search
        })

        if (!document || document.length === 0)
            throw new Error(`Document with id ${search} does not exist.`)

        if (document.length > 1)
            throw new Error(`More than one document with id ${search} exists.`)

        return asDocument(document[0])
    }

    /**
     * Adds new documents to the store.
     * @param texts An object where the keys are document IDs and the values are the documents themselves.
     * @returns Void
     */
    async add(texts: Record<string, Document>) {
        const documents = Object.keys(texts).map((id) =>
            toStoredDocument(texts[id], this.key, id)
        )
        await this.ctx.database.upsert('chatluna_docstore', documents)
    }

    async list(): Promise<Document[]> {
        return (
            await this.ctx.database.get('chatluna_docstore', {
                key: this.key
            })
        ).map(asDocument)
    }

    async delete(options: { ids?: string[]; deleteAll?: boolean }) {
        const { deleteAll, ids } = options

        if (deleteAll) {
            await this.ctx.database.remove('chatluna_docstore', {
                key: this.key
            })
            return
        }

        await this.ctx.database.remove('chatluna_docstore', {
            key: this.key,
            id: ids
        })
    }
}

declare module 'koishi' {
    interface Tables {
        chatluna_docstore: ChatLunaDocument
    }
}

export interface ChatLunaDocument {
    pageContent: string
    id: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: Record<string, any>
    key: string
}

export function asDocument(document: ChatLunaDocument): Document {
    return new Document({
        pageContent: document.pageContent,
        metadata: document.metadata,
        id: document.id
    })
}

export function toStoredDocument(
    document: Document,
    key: string,
    id?: string
): ChatLunaDocument {
    document.id = id ?? document.id
    return {
        pageContent: document.pageContent,
        id: document.id,
        metadata: document.metadata,
        key
    }
}
