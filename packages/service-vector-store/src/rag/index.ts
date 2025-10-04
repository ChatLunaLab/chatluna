import { StandardRAGRetriever, StandardRAGRetrieverConfig } from './standard'
import { HippoRAGRetriever, HippoRAGRetrieverConfig } from './hipporag/index'

export * from './base'

export { StandardRAGRetriever, createStandardRAGRetriever } from './standard'
export type { StandardRAGRetrieverConfig, RetrievalStrategy } from './standard'
export {
    HippoRAG,
    HippoRAGConfig,
    HippoRAGRetriever,
    createHippoRAGRetriever
} from './hipporag'

export type RAGRetrieverType = 'standard' | 'hippo_rag'

export type RAGRetrieverConfig<T extends RAGRetrieverType = RAGRetrieverType> =
    T extends 'standard'
        ? StandardRAGRetrieverConfig
        : T extends 'hippo_rag'
          ? HippoRAGRetrieverConfig
          : never

export type RAGRetrieverInstance<
    T extends RAGRetrieverType = RAGRetrieverType
> = T extends 'standard'
    ? StandardRAGRetriever
    : T extends 'hippo_rag'
      ? HippoRAGRetriever
      : never
