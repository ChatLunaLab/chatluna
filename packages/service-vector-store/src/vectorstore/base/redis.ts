import {
    ChatLunaSaveableVectorDelete,
    ChatLunaSaveableVectorStore,
    ChatLunaSaveableVectorStoreInput
} from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { RedisVectorStore } from '@langchain/redis'
import crypto from 'crypto'
import { DocumentInterface } from '@langchain/core/documents'
import type { createClient } from 'redis'

export class RedisVectorStoreWrapper extends ChatLunaSaveableVectorStore<RedisVectorStore> {
    private _client: ReturnType<typeof createClient>
    constructor(input: RedisVectorStoreWrapperInput) {
        super(input)
        this._client = input.client
    }

    addDocuments(
        documents: DocumentInterface[],
        options?: Parameters<RedisVectorStore['addDocuments']>[1]
    ): Promise<string[] | void> {
        let keys = options?.keys ?? []

        keys = documents.map((document, i) => {
            const id = keys[i] ?? document.id ?? crypto.randomUUID()

            document.id = id
            document.metadata = { ...document.metadata, raw_id: id }

            return this._store.keyPrefix + id
        })

        return super.addDocuments(documents, {
            ...options,
            keys
        })
    }

    async delete(options: ChatLunaSaveableVectorDelete): Promise<void> {
        if (options.deleteAll) {
            await this._client.ft.dropIndex(this._store.indexName, {
                DD: true
            })
            await super.delete(options)
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
                .filter((id): id is string => id != null)

            ids.push(...documentIds)
        }

        if (ids.length > 0) {
            for (const id of ids) {
                await this._client.del(this._store.keyPrefix + id)
            }
        }

        await super.delete(options)
    }

    async save() {
        // Redis doesn't need explicit saving
    }

    async free(): Promise<void> {
        await this._client.disconnect()
        return super.free()
    }
}

export interface RedisVectorStoreWrapperInput
    extends ChatLunaSaveableVectorStoreInput<RedisVectorStore> {
    client: ReturnType<typeof createClient>
}
