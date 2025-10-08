import { Context, Service } from 'koishi'
import {
    createHippoRAGRetriever,
    createLightRAGRetriever,
    type RAGRetrieverConfig,
    type RAGRetrieverInstance,
    type RAGRetrieverType
} from '../rag'
import { createStandardRAGRetriever } from '../rag/standard'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { computed, ComputedRef } from 'koishi-plugin-chatluna'
import { emptyEmbeddings } from 'koishi-plugin-chatluna/llm-core/model/in_memory'
import { RemoveKey } from '../utils'

export class ChatLunaRAGService extends Service {
    constructor(public ctx: Context) {
        super(ctx, 'chatluna_rag', true)
    }

    async createRAGRetriever<T extends RAGRetrieverType>(
        type: T,
        config: RemoveKey<RAGRetrieverConfig<T>, 'llm'> & {
            llm?: ComputedRef<ChatLunaChatModel>
        }
    ): Promise<ComputedRef<RAGRetrieverInstance<T>>> {
        const caller = this[Context.origin]
        const embeddingsRef = await this.ctx.chatluna.createEmbeddings(
            this.ctx.chatluna.config.defaultEmbeddings
        )

        const llmRef = config.llm

        if (embeddingsRef.value === emptyEmbeddings) {
            throw new Error('No embeddings found')
        }

        if (type === 'standard') {
            return computed(() => {
                const embeddings = embeddingsRef.value
                const llm = llmRef?.value

                return createStandardRAGRetriever(caller, {
                    ...config,
                    embeddings,
                    llm
                })
            }) as ComputedRef<RAGRetrieverInstance<T>>
        } else if (type === 'hippo_rag') {
            return computed(() => {
                const embeddings = embeddingsRef.value
                const llm = llmRef?.value

                const hippoRagConfig = {
                    ...config,
                    embeddings,
                    llm
                } as unknown as RAGRetrieverConfig<'hippo_rag'>

                return createHippoRAGRetriever(caller, hippoRagConfig)
            }) as ComputedRef<RAGRetrieverInstance<T>>
        } else if (type === 'light_rag') {
            return computed(() => {
                const embeddings = embeddingsRef.value
                const llm = llmRef?.value

                const lightRagConfig = {
                    ...config,
                    embeddings,
                    llm
                } as unknown as RAGRetrieverConfig<'light_rag'>

                return createLightRAGRetriever(caller, lightRagConfig)
            }) as ComputedRef<RAGRetrieverInstance<T>>
        }

        throw new Error(`Unknown retriever type: ${type}`)
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_rag: ChatLunaRAGService
    }
}
