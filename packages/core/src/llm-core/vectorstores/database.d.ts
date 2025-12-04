import { Document } from '@langchain/core/documents'
import { Context } from 'koishi'
/**
 * Class for storing and retrieving documents in memory synchronously.
 */
export declare class DataBaseDocstore {
    private ctx
    private key
    constructor(ctx: Context, key: string)
    /**
     * Searches for a document in the store based on its ID.
     * @param search The ID of the document to search for.
     * @returns The document with the given ID.
     */
    get(search: string): Promise<Document>
    /**
     * Adds new documents to the store.
     * @param texts An object where the keys are document IDs and the values are the documents themselves.
     * @returns Void
     */
    add(texts: Record<string, Document>): Promise<void>
    list(options?: ListDocumentOptions): Promise<Document[]>
    delete(options: { ids?: string[]; deleteAll?: boolean }): Promise<void>
    stat(): Promise<{
        count: number
        lastUpdated: Date
    }>
}
declare module 'koishi' {
    interface Tables {
        chatluna_docstore: ChatLunaDocument
    }
}
export interface ChatLunaDocument {
    pageContent: string
    id: string
    metadata: Record<string, any>
    key: string
    createdAt: Date
}
export interface ListDocumentOptions {
    limit?: number
    ids?: string[]
    offset?: number
}
export declare function asDocument(document: ChatLunaDocument): Document
export declare function toStoredDocument(
    document: Document,
    key: string,
    id?: string
): ChatLunaDocument
