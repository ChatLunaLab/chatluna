import { Context } from 'koishi';
import VectorStorePlugin, { WrapperToolProvider } from '..';
import { ChatHubSaveableVectorStore, CreateVectorStoreRetrieverParams, VectorStoreRetrieverProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { VectorStoreRetriever } from 'langchain/vectorstores/base';
import { FaissStore } from 'langchain/vectorstores/faiss';
import path from 'path';
import fs from 'fs/promises';
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger';
import { request } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request"
import { Tool } from 'langchain/tools';
import CommonPlugin from '..';


const logger = createLogger('@dingyi222666/chathub-plugin-common/request')

export function apply(ctx: Context, config: VectorStorePlugin.Config,
    plugin: CommonPlugin) {

    if (config.request !== true) {
        return
    }

    const requestGetTool = new RequestsGetTool({
        "User-Agent": request.randomUA(),
    }, {
        maxOutputLength: config.requestMaxOutputLength,
    })

    const requestPostTool = new RequestsPostTool({
        "User-Agent": request.randomUA(),
    }, {
        maxOutputLength: config.requestMaxOutputLength,
    })


    plugin.registerToolProvider(WrapperToolProvider.wrap(requestGetTool.name, async (params) => {
        return requestGetTool
    }, requestGetTool.description))

    plugin.registerToolProvider(WrapperToolProvider.wrap(requestPostTool.name, async (params) => {
        return requestPostTool
    }, requestPostTool.description))

}



export interface Headers {
    [key: string]: string;
}

export interface RequestTool {
    headers: Headers;
    maxOutputLength: number;
}

export class RequestsGetTool extends Tool implements RequestTool {
    name = "requests_get";

    maxOutputLength = 2000;

    constructor(
        public headers: Headers = {},
        { maxOutputLength }: { maxOutputLength?: number } = {}
    ) {
        super(...arguments);

        this.maxOutputLength = maxOutputLength ?? this.maxOutputLength;
    }

    /** @ignore */
    async _call(input: string) {
        const res = await request.fetch(input, {
            headers: this.headers,
        });
        const text = await res.text();
        return text.slice(0, this.maxOutputLength);
    }

    description = `A portal to the internet. Use this when you need to get specific content from a website. 
  Input should be a url string (i.e. "https://www.google.com"). The output will be the text response of the GET request.`;
}

export class RequestsPostTool extends Tool implements RequestTool {
    name = "requests_post";

    maxOutputLength = Infinity;

    constructor(
        public headers: Headers = {},
        { maxOutputLength }: { maxOutputLength?: number } = {}
    ) {
        super(...arguments);

        this.maxOutputLength = maxOutputLength ?? this.maxOutputLength;
    }

    /** @ignore */
    async _call(input: string) {
        try {
            const { url, data } = JSON.parse(input);
            const res = await request.fetch(url, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify(data),
            });
            const text = await res.text();
            return text.slice(0, this.maxOutputLength);
        } catch (error) {
            return `${error}`;
        }
    }

    description = `Use this when you want to POST to a website.
  Input should be a json string with two keys: "url" and "data".
  The value of "url" should be a string, and the value of "data" should be a dictionary of 
  key-value pairs you want to POST to the url as a JSON body.
  Be careful to always use double quotes for strings in the json string
  The output will be the text response of the POST request.`;
}