import { Document } from '@langchain/core/documents'
import {
    VectorStore,
    VectorStoreRetriever,
    VectorStoreRetrieverInput
} from '@langchain/core/vectorstores'
export type ScoreThresholdRetrieverInput<V extends VectorStore> = Omit<
    VectorStoreRetrieverInput<V>,
    'k'
> & {
    maxK?: number
    kIncrement?: number
    minSimilarityScore: number
}
export declare class ScoreThresholdRetriever<
    V extends VectorStore
> extends VectorStoreRetriever<V> {
    minSimilarityScore: number
    kIncrement: number
    maxK: number
    constructor(input: ScoreThresholdRetrieverInput<V>)
    getRelevantDocuments(query: string): Promise<Document[]>
    static fromVectorStore<V extends VectorStore>(
        vectorStore: V,
        options: Omit<ScoreThresholdRetrieverInput<V>, 'vectorStore'>
    ): ScoreThresholdRetriever<V>
}
