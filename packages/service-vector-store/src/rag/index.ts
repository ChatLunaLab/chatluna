import { StandardRAGRetriever, StandardRAGRetrieverConfig } from './standard'
import { HippoRAGRetriever, HippoRAGRetrieverConfig } from './hipporag/index'
import { LightRAGRetriever, LightRAGRetrieverConfig } from './lightrag/index'

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
            : never

export type RAGRetrieverInstance<
    T extends RAGRetrieverType = RAGRetrieverType
> = T extends 'standard'
    ? StandardRAGRetriever
    : T extends 'hippo_rag'
      ? HippoRAGRetriever
      : T extends 'light_rag'
        ? LightRAGRetriever
        : never
