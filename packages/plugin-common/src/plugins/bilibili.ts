import { Context } from 'koishi';
import VectorStorePlugin, { WrapperToolProvider } from '..';
import { ChatHubSaveableVectorStore, CreateVectorStoreRetrieverParams, VectorStoreRetrieverProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { VectorStore, VectorStoreRetriever } from 'langchain/vectorstores/base';
import { FaissStore } from 'langchain/vectorstores/faiss';
import path from 'path';
import fs from 'fs/promises';
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger';
import { request } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request"
import { z } from "zod";
import CommonPlugin from '..';
import { BaseFileStore } from 'langchain/schema';
import { Tool, ToolParams } from 'langchain/tools';
import { Embeddings } from 'langchain/embeddings/base';
import { BaseLanguageModel } from 'langchain/base_language';


const logger = createLogger('@dingyi222666/chathub-plugin-common/fs')

export function apply(ctx: Context, config: VectorStorePlugin.Config,
    plugin: CommonPlugin) {

    if (config.bilibili !== true) {
        return
    }

  
    let bilibiliTool: BilibiliTool


    plugin.registerToolProvider(WrapperToolProvider.wrap("bilibili", async (params) => {
        if (bilibiliTool != null) {
            return bilibiliTool
        }
        bilibiliTool = new BilibiliTool({
            model: params.model,
            embeddings: params.embeddings,
            timeout: config.bilibiliTempTimeout
        })
        return bilibiliTool
    }, "A tool ??"))


}

export interface BilibiliArgs extends ToolParams {
    model: BaseLanguageModel;

    embeddings: Embeddings;

    timeout: number;
}

export class BilibiliTool extends Tool implements BilibiliArgs {
    name = "bilibili";

    private _tmpVectorStore: Record<string, VectorStore> = {}

    model: BaseLanguageModel;
    embeddings: Embeddings;
    timeout: number;

    constructor(
        {
            timeout,
            embeddings,
            model
        }: BilibiliArgs
    ) {
        super(...arguments);

        setInterval(() => {
            this._tmpVectorStore = {}
        }, timeout)
        this.timeout = timeout
        this.embeddings = embeddings
        this.model = model
    }

    /** @ignore */
    async _call(input: string) {
        const { bv, question } = JSON.parse(input)

        return ""
    }

    description = `A tool for accessing bilibili videos, which can be used to get video overview, information, input must be  a json string with two keys "bv", "question". The  If the question content is empty, it returns the video overview information. For example, if you want to get what topic the video talks about, you can input {"bv":"xxxx", "question":"What topic does this video talk about?}`;

}