import { DocumentInterface } from '@langchain/core/documents'
import { BaseDocumentCompressor } from '@langchain/core/retrievers/document_compressors'
import {
    AsyncCaller,
    AsyncCallerParams
} from '@langchain/core/utils/async_caller'
import {
    RerankerRequester,
    RerankerRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { logger } from 'koishi-plugin-chatluna'
import type { ModelUsageReporter } from './usage'
import { estimateTextTokens } from './usage'

export interface ChatLunaRerankerParams extends AsyncCallerParams {
    timeout?: number
    maxRetries?: number
    client: RerankerRequester
    model?: string
    topN?: number
    maxChunksPerDoc?: number
    usageReporter?: ModelUsageReporter
    usageSource?: string
}

export class ChatLunaReranker extends BaseDocumentCompressor {
    modelName = 'bge-reranker-v2-m3'

    // topN limits direct rerank() calls; compressDocuments reranks all inputs.
    topN = 3

    maxChunksPerDoc?: number

    timeout: number

    caller: AsyncCaller

    private _client: RerankerRequester
    private _report?: ModelUsageReporter
    private _usageSource?: string

    constructor(fields: ChatLunaRerankerParams) {
        super()

        this.caller = new AsyncCaller(fields)
        this.timeout = fields.timeout ?? 1000 * 60
        this.modelName = fields.model ?? this.modelName
        this.topN = fields.topN ?? this.topN
        this.maxChunksPerDoc = fields.maxChunksPerDoc
        this._client = fields.client
        this._report = fields.usageReporter
        this._usageSource = fields.usageSource
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

        const request = {
            model: options?.model ?? this.modelName,
            query,
            documents: docStrings,
            topN: options?.topN ?? this.topN,
            maxChunksPerDoc: options?.maxChunksPerDoc ?? this.maxChunksPerDoc
        }
        const data = await this._rerankWithRetry(request)
        const results = Array.isArray(data) ? data : data.results

        await this._reportUsage(
            [request.query, ...request.documents],
            Array.isArray(data) ? undefined : data.usage
        )

        return results.map((result) => ({
            index: result.index,
            relevanceScore: result.relevanceScore
        }))
    }

    private async _rerankWithRetry(
        request: RerankerRequestParams
    ): ReturnType<RerankerRequester['rerank']> {
        const timeoutError = new ChatLunaError(
            ChatLunaErrorCode.API_REQUEST_TIMEOUT,
            new Error(`timeout when calling ${request.model} reranker`),
            true
        )

        const makeRequest = async () => {
            let timeoutId: NodeJS.Timeout

            const timeoutPromise = new Promise<
                Awaited<ReturnType<RerankerRequester['rerank']>>
            >(
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

    private async _reportUsage(
        input: string[],
        usage?: {
            total_tokens?: number
            input_tokens?: number
            output_tokens?: number
        }
    ) {
        if (this._report == null) return

        try {
            const inputTokens =
                usage?.input_tokens ??
                usage?.total_tokens ??
                (await estimateTextTokens(input))
            await this._report({
                callType: 'reranker',
                source: this._usageSource,
                inputTokens,
                outputTokens: usage?.output_tokens ?? 0,
                totalTokens: usage?.total_tokens ?? inputTokens,
                estimated: usage == null
            })
        } catch (e) {
            logger.warn('Failed to report reranker usage', e)
        }
    }
}
