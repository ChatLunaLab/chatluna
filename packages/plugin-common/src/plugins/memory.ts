import { Tool } from '@langchain/core/tools'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { CreateToolParams } from 'koishi-plugin-chatluna/llm-core/platform/types'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.memory !== true) {
        return
    }

    await plugin.registerTool('memory_search', {
        selector(history) {
            return true
        },

        async createTool(params, session) {
            return new MemorySearchTool(ctx, params)
        }
    })

    await plugin.registerTool('memory_save', {
        selector(history) {
            return true
        },

        async createTool(params, session) {
            return new MemorySaveTool(ctx, params)
        }
    })
}

export class MemorySearchTool extends Tool {
    name = 'memory_search'

    constructor(
        private ctx: Context,
        private params: CreateToolParams
    ) {
        super({})
    }

    /** @ignore */
    async _call(input: string) {
        const defaultVectorStoreName =
            this.ctx.chatluna.config.defaultVectorStore

        const vectorStore = await this.ctx.chatluna.platform.createVectorStore(
            defaultVectorStoreName,
            {
                embeddings: this.params.embeddings,
                key: this.params.conversationId
            }
        )

        if (!vectorStore) {
            return 'An error occurred while searching for memories.'
        }
        const result = await vectorStore.similaritySearch(input, 10)

        return result
            .map((item) => {
                return item.pageContent
            })
            .join('\n')
    }

    // eslint-disable-next-line max-len
    description = `This plugin provides a way to search through memories related to the user. The input should be a short phrase or word that you want to search for. For example, if you want to know the user's birthday, you would input "birthday". The return will be a few memory snippets, feel free to integrate them into the conversation as you need.`
}

export class MemorySaveTool extends Tool {
    name = 'memory_save'

    constructor(
        private ctx: Context,
        private params: CreateToolParams
    ) {
        super({})
    }

    /** @ignore */
    async _call(input: string) {
        const defaultVectorStoreName =
            this.ctx.chatluna.config.defaultVectorStore

        const vectorStore = await this.ctx.chatluna.platform.createVectorStore(
            defaultVectorStoreName,
            {
                embeddings: this.params.embeddings,
                key: this.params.conversationId
            }
        )

        if (!vectorStore) {
            return 'An error occurred while saving memories.'
        }

        await vectorStore.addDocuments([
            {
                pageContent: input,
                metadata: {}
            }
        ])

        return 'Memory saved successfully.'
    }

    // eslint-disable-next-line max-len
    description: string = `This tool provides a way to save memories related to the user. Please call this tool to save the memory when you encounter some key information or points. The input should be the key points of the memory you want to save. Please follow the rule below:

    - The facts, preferences, and memories should be concise and informative.
    - Don't start by "The person likes Pizza". Instead, start with "Likes Pizza".
    - Don't remember the user/agent details provided. Only remember the facts, preferences, and memories.
    - The output language should be the same as the input language. For example, if the input language is Chinese, the output language should also be Chinese.`
}
