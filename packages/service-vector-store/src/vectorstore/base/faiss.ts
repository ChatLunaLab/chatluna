import {
    ChatLunaSaveableVectorDelete,
    ChatLunaSaveableVectorStore,
    ChatLunaSaveableVectorStoreInput
} from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { FaissStore } from '@langchain/community/vectorstores/faiss'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { DocumentInterface } from '@langchain/core/documents'

export class FaissVectorStore extends ChatLunaSaveableVectorStore<FaissStore> {
    private _directory: string
    constructor(input: FaissVectorStoreInput) {
        super(input)
        this._directory = input.directory
    }

    addDocuments(
        documents: DocumentInterface[],
        options?: Parameters<FaissStore['addDocuments']>[1]
    ): Promise<string[] | void> {
        let ids = options?.ids ?? []

        ids = documents.map((document, i) => {
            const id = ids[i] ?? document.id ?? randomUUID()

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
            await super.delete(options)
            await fs.rm(this._directory, { recursive: true })
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
}

export interface FaissVectorStoreInput
    extends ChatLunaSaveableVectorStoreInput<FaissStore> {
    directory: string
}
