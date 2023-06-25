import { Context } from 'koishi';
import VectorStorePlugin from '..';
import { ChatHubSaveableVectorStore, CreateVectorStoreRetrieverParams, VectorStoreRetrieverProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { VectorStoreRetriever } from 'langchain/vectorstores/base';
import { FaissStore } from 'langchain/vectorstores/faiss';
import path from 'path';
import fs from 'fs/promises';
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger';


const logger = createLogger('@dingyi222666/chathub-vector-store/faiss')

export function apply(ctx: Context, config: VectorStorePlugin.Config,
    plugin: VectorStorePlugin) {

    if (!(config.current === "faiss")) {
        return
    }

    plugin.registerVectorStoreRetrieverProvider(new FaissVectorStoreRetrieverProvider(config))
}

class FaissVectorStoreRetrieverProvider extends VectorStoreRetrieverProvider {

    name = "faiss"
    description = "faiss vector store"

    constructor(private readonly _config: VectorStorePlugin.Config) {
        super();
    }

    isSupported(modelName: string): Promise<boolean> {

        return super.isSupported(modelName)
    }

    async createVectorStoreRetriever(params: CreateVectorStoreRetrieverParams): Promise<VectorStoreRetriever> {
        const embeddings = params.embeddings
        let faissStore: FaissStore

        const directory = path.join(this._config.faissSavePath, params.mixedSenderId ?? "")

        const jsonFile = path.join(directory, "docstore.json")

        logger.debug(`Loading faiss store from ${directory}`)

        try {
            await fs.access(jsonFile)
            faissStore = await FaissStore.load(directory, embeddings)
        } catch {
            faissStore = await FaissStore.fromTexts(['user:hello', 'your: How can I assist you today?', " "], [''], embeddings)
        }

        const wrapperStore = new ChatHubSaveableVectorStore(faissStore, (store) => store.save(directory))

        return wrapperStore.asRetriever(this._config.topK)
    }

}
