import { Context } from 'koishi';
import VectorStorePlugin from '..';
import { CreateVectorStoreRetrieverParams, VectorStoreRetrieverProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { VectorStoreRetriever } from 'langchain/vectorstores/base';
import { PineconeStore } from "langchain/vectorstores/pinecone";
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger';


const logger = createLogger('@dingyi222666/chathub-vector-store/faiss')

export function apply(ctx: Context, config: VectorStorePlugin.Config,
    plugin: VectorStorePlugin) {

   /*  if (config.current !== "pinecone") {
        return
    } */

    plugin.registerVectorStoreRetrieverProvider(new PineconeVectorStoreRetrieverProvider(config))
}

class PineconeVectorStoreRetrieverProvider extends VectorStoreRetrieverProvider {

    name = "pinecone"
    description = "pinecone vector store"

    constructor(private readonly _config: VectorStorePlugin.Config) {
        super();
    }

    isSupported(modelName: string): Promise<boolean> {
        return super.isSupported(modelName)
    }

    async createVectorStoreRetriever(params: CreateVectorStoreRetrieverParams): Promise<VectorStoreRetriever> {
        const embeddings = params.embeddings

        const client = new (await PineconeVectorStoreRetrieverProvider._importPinecone()).PineconeClient()

        await client.init({
            apiKey: this._config.pineconeKey,
            environment: this._config.pineconeRegon,
        });
        const pineconeIndex = client.Index(this._config.pineconeIndex);

        const store = await PineconeStore.fromExistingIndex(embeddings, {
            pineconeIndex,
            namespace: params.mixedSenderId ?? "chathub"
        });

        return store.asRetriever(this._config.topK)
    }


    private static async _importPinecone() {
        try {
            const {
                PineconeClient
            } = await import("@pinecone-database/pinecone");

            return { PineconeClient };
        } catch (err) {
            logger.error(err);
            throw new Error(
                "Please install @pinecone-database/pinecone as a dependency with, e.g. `npm install -S @pinecone-database/pinecone`"
            );
        }
    }
}
