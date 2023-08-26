import { BaseLLM } from 'langchain/llms/base';
import { BaseChatModel, BaseChatModelCallOptions } from 'langchain/chat_models/base';
import { Embeddings } from 'langchain/embeddings/base';
import { SaveableVectorStore, VectorStore, VectorStoreRetriever } from 'langchain/vectorstores/base';
import { PromiseLikeDisposable } from '../utils/types';
import { Tool } from 'langchain/tools';
import { encodingForModel } from '../utils/tiktoken';
import { getModelContextSize, getModelNameForTiktoken } from '../utils/count_tokens';
import { Tiktoken } from 'js-tiktoken/lite';
import { Document } from 'langchain/document';
import { createLogger } from '../utils/logger';
import { ChatHubChatChain } from '../chain/chat_chain';
import { ChatHubLLMChainWrapper } from '../chain/base';

const logger = createLogger("@dingyi222666/chathub/llm-core/model/base");

export class ChatHubSaveableVectorStore<T extends VectorStore> extends VectorStore {
    constructor(
        private _store: T,
        private _saveableFunction: (store: T) => Promise<void>,
    ) {
        super(_store.embeddings, {})
    }

    addVectors(vectors: number[][], documents: Document[]) {
        return this._store.addVectors(vectors, documents)
    }
    addDocuments(documents: Document[]) {
        return this._store.addDocuments(documents)
    }
    similaritySearchVectorWithScore(query: number[], k: number, filter?: this["FilterType"]) {
        return this._store.similaritySearchVectorWithScore(query, k, filter)
    }

    save() {
        return this._saveableFunction(this._store)
    }

    _vectorstoreType(): string {
        return this._store?._vectorstoreType() ?? "?"
    }
}