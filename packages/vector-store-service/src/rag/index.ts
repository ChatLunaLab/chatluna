import { StandardRAGRetriever, StandardRAGRetrieverConfig } from './standard'
import { HippoRAGConfig } from './hipporag/config'
import { HippoRAGRetriever } from './hipporag/index'

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
          ? HippoRAGConfig
          : never

export type RAGRetrieverInstance<
    T extends RAGRetrieverType = RAGRetrieverType
> = T extends 'standard'
    ? StandardRAGRetriever
    : T extends 'hippo_rag'
      ? HippoRAGRetriever
      : never
