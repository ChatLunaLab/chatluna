import { DocumentInterface } from '@langchain/core/documents'
import { BaseDocumentCompressor } from '@langchain/core/retrievers/document_compressors'
import {
    AsyncCaller,
    AsyncCallerParams
} from '@langchain/core/utils/async_caller'
import {
    RerankerRequester,
    RerankerRequestParams,
    RerankerResult
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'

export interface ChatLunaRerankerParams extends AsyncCallerParams {
    timeout?: number
    maxRetries?: number
    client: RerankerRequester
    model?: string
    topN?: number
    maxChunksPerDoc?: number
}

export class ChatLunaReranker extends BaseDocumentCompressor {
    modelName = 'bge-reranker-v2-m3'

    // topN limits direct rerank() calls; compressDocuments reranks all inputs.
    topN = 3

    maxChunksPerDoc?: number

    timeout: number

    caller: AsyncCaller

    private _client: RerankerRequester

    constructor(fields: ChatLunaRerankerParams) {
        super()

        this.caller = new AsyncCaller(fields)
        this.timeout = fields.timeout ?? 1000 * 60
        this.modelName = fields.model ?? this.modelName
        this.topN = fields.topN ?? this.topN
        this.maxChunksPerDoc = fields.maxChunksPerDoc
        this._client = fields.client
    }

    async compressDocuments(
        documents: DocumentInterface[],
        query: string
    ): Promise<DocumentInterface[]> {
        if (documents == null || documents.length === 0) {
            return []
        }

        const results = await this.rerank(documents, query, {
            topN: documents.length
        })

        return results.map((result) => {
            const original = documents[result.index]
            return {
                ...original,
                metadata: {
                    ...original.metadata,
                    relevanceScore: result.relevanceScore
                }
            }
        })
    }

    async rerank(
        documents: (DocumentInterface | string | Record<string, string>)[],
        query: string,
        options?: {
            model?: string
            topN?: number
            maxChunksPerDoc?: number
        }
    ): Promise<{ index: number; relevanceScore: number }[]> {
        const docStrings = documents.map((doc) =>
            typeof doc === 'string'
                ? doc
                : 'pageContent' in doc
                  ? doc.pageContent
                  : JSON.stringify(doc)
        )

        const results = await this._rerankWithRetry({
            model: options?.model ?? this.modelName,
            query,
            documents: docStrings,
            topN: options?.topN ?? this.topN,
            maxChunksPerDoc: options?.maxChunksPerDoc ?? this.maxChunksPerDoc
        })

        return results.map((result) => ({
            index: result.index,
            relevanceScore: result.relevanceScore
        }))
    }

    private async _rerankWithRetry(
        request: RerankerRequestParams
    ): Promise<RerankerResult[]> {
        const timeoutError = new ChatLunaError(
            ChatLunaErrorCode.API_REQUEST_TIMEOUT,
            new Error(`timeout when calling ${request.model} reranker`),
            true
        )

        const makeRequest = async () => {
            let timeoutId: NodeJS.Timeout

            const timeoutPromise = new Promise<RerankerResult[]>(
                // eslint-disable-next-line promise/param-names
                (_, reject) => {
                    timeoutId = setTimeout(() => {
                        reject(timeoutError)
                    }, this.timeout)
                }
            )

            try {
                return await Promise.race([
                    this._client.rerank(request),
                    timeoutPromise
                ])
            } catch (e) {
                if (e instanceof ChatLunaError) {
                    throw e
                }
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            } finally {
                clearTimeout(timeoutId)
            }
        }

        try {
            return await this.caller.call(makeRequest)
        } catch (e) {
            if (e instanceof ChatLunaError) {
                throw e
            }
            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
        }
    }
}
