import {
    ChatLunaSaveableVectorDelete,
    ChatLunaSaveableVectorStore,
    ChatLunaSaveableVectorStoreInput
} from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { Milvus } from '@langchain/community/vectorstores/milvus'
import crypto from 'crypto'
import { Document, DocumentInterface } from '@langchain/core/documents'

export class MilvusVectorStore extends ChatLunaSaveableVectorStore<Milvus> {
    private _key: string
    private _createCollection: () => Promise<void>

    constructor(input: MilvusVectorStoreInput) {
        super(input)
        this._key = input.key
        this._createCollection = input.createCollection
    }

    addDocuments(
        documents: DocumentInterface[],
        options?: Parameters<Milvus['addDocuments']>[1]
    ): Promise<string[] | void> {
        let ids = options?.ids ?? []

        ids = documents.map((document, i) => {
            const id = ids[i] ?? document.id ?? crypto.randomUUID()

            document.id = id
            document.metadata = Object.assign(
                {
                    raw_id: 'z'.repeat(100),
                    source: 'z'.repeat(100),
                    expirationDate: 'z'.repeat(100),
                    createdAt: 'z'.repeat(100),
                    updateAt: 'z'.repeat(100),
                    time: 'z'.repeat(100),
                    user: 'z'.repeat(100),
                    userId: 'z'.repeat(100),
                    type: 'z'.repeat(100),
                    importance: 0
                },
                {
                    source: 'unknown',
                    ...document.metadata,
                    raw_id: id
                }
            )

            return id.replaceAll('-', '_')
        })

        return super.addDocuments(documents, {
            ...options,
            ids
        })
    }

    async delete(options: ChatLunaSaveableVectorDelete): Promise<void> {
        if (options.deleteAll) {
            await this._store.client.releasePartitions({
                collection_name: 'chatluna_collection',
                partition_names: [this._key]
            })

            await this._store.client.releaseCollection({
                collection_name: 'chatluna_collection'
            })

            await this._store.client.dropPartition({
                collection_name: 'chatluna_collection',
                partition_name: this._key
            })

            await super.delete(options)
            return
        }

        const ids: string[] = []

        if (options.ids) {
            ids.push(...options.ids.map((id) => id.replaceAll('-', '_')))
        }

        if (options.documents) {
            const documentIds = options.documents
                ?.map((document) => {
                    const id = document.metadata?.raw_id as string | undefined
                    return id != null ? id.replaceAll('-', '_') : undefined
                })
                .filter((id): id is string => id != null)

            ids.push(...documentIds)
        }

        if (ids.length > 0) {
            const deleteResp = await this._store.client.delete({
                collection_name: this._store.collectionName,
                partition_name: this._key,
                ids
            })

            if (deleteResp.status.error_code !== 'Success') {
                throw new Error(
                    `Error deleting data with ids: ${JSON.stringify(deleteResp)}`
                )
            }
        }

        await super.delete(options)
    }

    async similaritySearchVectorWithScore(
        query: number[],
        k: number,
        filter?: this['FilterType']
    ): Promise<[DocumentInterface, number][]> {
        const hasColResp = await this._store.client.hasCollection({
            collection_name: this._store.collectionName
        })
        if (hasColResp.status.error_code !== 'Success') {
            throw new Error(`Error checking collection: ${hasColResp}`)
        }
        if (hasColResp.value === false) {
            console.warn(
                `Collection ${this._store.collectionName} does not exist, ensure all data and recreate collection.`
            )

            await this._createCollection()
        }

        const filterStr = filter ?? ''

        await this._store.grabCollectionFields()

        const loadResp = await this._store.client.loadCollectionSync({
            collection_name: this._store.collectionName
        })
        if (loadResp.error_code !== 'Success') {
            throw new Error(`Error loading collection: ${loadResp}`)
        }

        // clone this.field and remove vectorField
        const outputFields = this._store.fields.filter(
            (field) => field !== this._store.vectorField
        )

        const searchResp = await this._store.client.search({
            collection_name: this._store.collectionName,
            search_params: {
                anns_field: this._store.vectorField,
                topk: k,
                metric_type: this._store.indexCreateParams.metric_type,
                params: JSON.stringify(this._store.indexSearchParams)
            },
            output_fields: outputFields,
            // add partition_names
            partition_names: this._store.partitionName
                ? [this._store.partitionName]
                : undefined,
            // DataType.FloatVector
            vector_type: 101,
            vectors: [query],
            filter: filterStr
        })
        if (searchResp.status.error_code !== 'Success') {
            throw new Error(
                `Error searching data: ${JSON.stringify(searchResp)}`
            )
        }
        const results: [Document, number][] = []
        searchResp.results
            .flatMap((result) => {
                if (!Array.isArray(result)) return [result]
                return result
            })
            .forEach((result) => {
                const fields = {
                    pageContent: '',
                    id: '',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    metadata: {} as Record<string, any>
                }
                Object.keys(result).forEach((key) => {
                    if (key === this._store.textField) {
                        fields.pageContent = result[key]
                    } else if (
                        this._store.fields.includes(key) ||
                        key === this._store.primaryField
                    ) {
                        if (typeof result[key] === 'string') {
                            const { isJson, obj } = checkJsonString(result[key])
                            fields.metadata[key] = isJson ? obj : result[key]
                        } else {
                            fields.metadata[key] = result[key]
                        }
                    }
                })
                fields.id = fields.metadata['raw_id']
                results.push([new Document(fields), result.score])
            })
        return results
    }

    async save() {
        // Milvus doesn't need explicit saving
    }

    async free(): Promise<void> {
        this._store = undefined
        return super.free()
    }
}

export interface MilvusVectorStoreInput
    extends ChatLunaSaveableVectorStoreInput<Milvus> {
    key: string
    createCollection: () => Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkJsonString(value: string): { isJson: boolean; obj: any } {
    try {
        const result = JSON.parse(value)
        return { isJson: true, obj: result }
    } catch (e) {
        return { isJson: false, obj: null }
    }
}
