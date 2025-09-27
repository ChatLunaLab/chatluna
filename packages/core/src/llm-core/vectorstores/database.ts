import { Document } from '@langchain/core/documents'
import { $, Context } from 'koishi'

/**
 * Class for storing and retrieving documents in memory synchronously.
 */
export class DataBaseDocstore {
    constructor(
        private ctx: Context,
        private key: string
    ) {
        // Magic code. Unstable.`
        this.ctx.runtime.inject['database'] = {
            required: false
        }
    }

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

    async list(options?: ListDocumentOptions): Promise<Document[]> {
        if (!options) {
            return (
                await this.ctx.database.get('chatluna_docstore', {
                    key: this.key
                })
            ).map(asDocument)
        }

        return await this.ctx.database
            .select('chatluna_docstore')
            .where((row) =>
                $.and(
                    $.eq(row.key, this.key),
                    ...(options.ids?.length > 0
                        ? [$.in(row.id, options.ids)]
                        : [])
                )
            )
            .orderBy((row) => row.createdAt, 'asc')
            .limit(options.limit ?? 10)
            .offset(options.offset ?? 0)
            .execute()
            .then((rows) => rows.map(asDocument))
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

    async stat(): Promise<{ count: number; lastUpdated: Date }> {
        const count = await this.ctx.database
            .select('chatluna_docstore')
            .where((row) => $.eq(row.key, this.key))
            .execute((row) => $.count(row.id))

        const lastUpdated = await this.ctx.database
            .select('chatluna_docstore')
            .where((row) => $.eq(row.key, this.key))
            .execute((row) => $.max(row.createdAt))

        return {
            count,
            lastUpdated
        }
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
    createdAt: Date
}

export interface ListDocumentOptions {
    limit?: number
    ids?: string[]
    offset?: number
}

export function asDocument(document: ChatLunaDocument): Document {
    return new Document({
        pageContent: document.pageContent,
        metadata: {
            ...document.metadata,
            createdAt: document.createdAt
        },
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
        createdAt: new Date(),
        key
    }
}
