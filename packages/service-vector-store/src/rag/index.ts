import { StandardRAGRetriever, StandardRAGRetrieverConfig } from './standard'
import { HippoRAGRetriever, HippoRAGRetrieverConfig } from './hipporag/index'
import { LightRAGRetriever, LightRAGRetrieverConfig } from './lightrag/index'
import { BaseRAGRetriever, RetrieverConfig } from './base'

export * from './base'

export { StandardRAGRetriever, createStandardRAGRetriever } from './standard'
export type { StandardRAGRetrieverConfig, RetrievalStrategy } from './standard'
export {
    HippoRAG,
    HippoRAGConfig,
    HippoRAGRetriever,
    createHippoRAGRetriever
} from './hipporag'
export { LightRAGRetriever, createLightRAGRetriever } from './lightrag'
export type { LightRAGRetrieverConfig } from './lightrag'

export type RAGRetrieverType = 'standard' | 'hippo_rag' | 'light_rag'

export type RAGRetrieverConfig<T extends RAGRetrieverType = RAGRetrieverType> =
    T extends 'standard'
        ? StandardRAGRetrieverConfig
        : T extends 'hippo_rag'
          ? HippoRAGRetrieverConfig
          : T extends 'light_rag'
            ? LightRAGRetrieverConfig
            : RetrieverConfig

export type RAGRetrieverInstance<
    T extends RAGRetrieverType = RAGRetrieverType
> = T extends 'standard'
    ? StandardRAGRetriever
    : T extends 'hippo_rag'
      ? HippoRAGRetriever
      : T extends 'light_rag'
        ? LightRAGRetriever
        : BaseRAGRetriever
