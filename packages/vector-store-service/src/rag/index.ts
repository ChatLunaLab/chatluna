import { StandardRAGRetriever, StandardRAGRetrieverConfig } from './standard'

export * from './base'

export { StandardRAGRetriever, createStandardRAGRetriever } from './standard'
export type { StandardRAGRetrieverConfig, RetrievalStrategy } from './standard'

export type RAGRetrieverType = 'standard'

export type RAGRetrieverConfig<T extends RAGRetrieverType = RAGRetrieverType> =
    T extends 'standard' ? StandardRAGRetrieverConfig : never

export type RAGRetrieverInstance<
    T extends RAGRetrieverType = RAGRetrieverType
> = T extends 'standard' ? StandardRAGRetriever : never
