import { Context } from 'koishi';
import VectorStorePlugin, { WrapperToolProvider } from '..';
import { ChatHubSaveableVectorStore, CreateVectorStoreRetrieverParams, VectorStoreRetrieverProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { VectorStoreRetriever } from 'langchain/vectorstores/base';
import { FaissStore } from 'langchain/vectorstores/faiss';
import path from 'path';
import fs from 'fs/promises';
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger';
import { request } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request"
import { z } from "zod";
import CommonPlugin from '..';
import { BaseFileStore } from 'langchain/schema';
import { Tool, ToolParams } from 'langchain/tools';


const logger = createLogger('@dingyi222666/chathub-plugin-common/fs')

export function apply(ctx: Context, config: VectorStorePlugin.Config,
    plugin: CommonPlugin) {

    if (config.fs !== true) {
        return
    }

    const store = new FileStore(config.fsScopePath ?? "")

    const fileReadTool = new ReadFileTool({
        store
    })

    const fileWriteTool = new WriteFileTool({
        store
    })

    plugin.registerToolProvider(fileReadTool.name, WrapperToolProvider.wrap(fileReadTool.name, async (params) => {
        return fileReadTool
    }, fileReadTool.description))

    plugin.registerToolProvider(fileWriteTool.name, WrapperToolProvider.wrap(fileWriteTool.name, async (params) => {
        return fileWriteTool
    }, fileWriteTool.description))

}

class FileStore extends BaseFileStore {


    constructor(private _scope: string) { super() }

    async readFile(path: string): Promise<string> {
        // check the path is in scope, if not, throw error

        if (!path.startsWith(this._scope)) {
            throw new Error(`path "${path}" is not in scope "${this._scope}"`)
        }

        return JSON.stringify(
            {
                path: path,
                content: (await fs.readFile(path)).toString()
            }
        )
    }

    async writeFile(writePath: string, contents: string): Promise<void> {
        if (!writePath.startsWith(this._scope)) {
            throw new Error(`path "${path}" is not in scope "${this._scope}"`)
        }

        // check the parent dir is exists, if not, create it

        const dir = path.dirname(writePath)

        try {
            await fs.access(dir)
        } catch {
            await fs.mkdir(dir, { recursive: true })
        }

        return fs.writeFile(writePath, contents)
    }

    lc_namespace: string[] = [];
}


interface ReadFileParams extends ToolParams {
    store: BaseFileStore;
}

export class ReadFileTool extends Tool {

    name = "read_file";

    description = "Read file from disk, The input must be a path.";

    store: BaseFileStore;

    constructor({ store }: ReadFileParams) {
        super(...arguments);

        this.store = store;
    }

    async _call(file_path: z.infer<typeof this.schema>) {
        return await this.store.readFile(file_path);
    }
}

interface WriteFileParams extends ToolParams {
    store: BaseFileStore;
}

export class WriteFileTool extends Tool {


    name = "write_file";

    description = `Write file from disk. The input must be like following "file_path", "text", E.g. "./test.txt", "hello world". `;

    store: BaseFileStore;

    constructor({ store, ...rest }: WriteFileParams) {
        super(rest);

        this.store = store;
    }

    private _readInput(rawText: string) {
        // match use regex
        const regex = /"(.*)",(\s*)?"(.*)"$/;
        const match = rawText.match(regex);
        if (!match) {
            throw new Error(`Input "${rawText}" is not match the regex "${regex}"`);
        }
        const filePath = match[1];
        const text = match[3];
        return { filePath, text };
    }

    async _call(rawText: z.infer<typeof this.schema>) {
        const { filePath, text } = this._readInput(rawText);
        await this.store.writeFile(filePath, text);
        return "File written to successfully.";
    }
}