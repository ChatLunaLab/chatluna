import { Context } from 'koishi';
import VectorStorePlugin from '..';
import { CreateVectorStoreRetrieverParams, VectorStoreRetrieverProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { VectorStoreRetriever } from 'langchain/vectorstores/base';
import { LanceDB } from "langchain/vectorstores/lancedb";
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger';
import type { Table } from 'vectordb';
import path from 'path';
import fs from 'fs/promises';

const logger = createLogger('@dingyi222666/chathub-vector-store/lancedb')

export function apply(ctx: Context, config: VectorStorePlugin.Config,
    plugin: VectorStorePlugin) {

    plugin.registerVectorStoreRetrieverProvider(new LanceDBVectorStoreRetrieverProvider(config))
}

class LanceDBVectorStoreRetrieverProvider extends VectorStoreRetrieverProvider {

    name = "lancedb"
    description = "lance db vector store"

    constructor(private readonly _config: VectorStorePlugin.Config) {
        super();
    }

    isSupported(modelName: string): Promise<boolean> {
        return super.isSupported(modelName)
    }

    async createVectorStoreRetriever(params: CreateVectorStoreRetrieverParams): Promise<VectorStoreRetriever> {
        const embeddings = params.embeddings

        const directory = path.join('data/chathub/vector_store/lancedb', params.mixedSenderId ?? "chathub")

        try {
            await fs.access(directory)
        } catch {
            await fs.mkdir(directory, { recursive: true })
        }

        logger.debug(`Loading lancedb from ${directory}`)


        const client = await (await LanceDBVectorStoreRetrieverProvider._importLanceDB()).connect(directory)

        const tableNames = await client.tableNames()

        let table: Table<number[]>
        let store: LanceDB

        if (tableNames.some(text => text === "vectors")) {
            table = await client.openTable("vectors")
        } else {
            table = await client.createTable("vectors", [
                { vector: Array(this._config.vectorSize), text: "sample" },
            ]);
        }

        store = await LanceDB.fromTexts(
            ['user:hello'],
            [],
            embeddings,
            { table }
        );

        return store.asRetriever(this._config.topK)
    }


    private static async _importLanceDB() {
        try {
            const any = await import("vectordb");

            return any;
        } catch (err) {
            logger.error(err);
            throw new Error(
                "Please install vectordb as a dependency with, e.g. `npm install -S vectordb`"
            );
        }
    }
}
