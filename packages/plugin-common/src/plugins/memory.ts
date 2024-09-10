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
    description = `Searches user-related memories. Input a brief keyword or phrase (e.g., "birthday"). Returns relevant memory snippets for conversation integration.`
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
    description = `Saves key user-related information. Use for important facts, preferences, or memories. Guidelines:

    - Be concise and informative
    - Start directly with the fact (e.g., "Likes pizza" not "The person likes pizza")
    - Focus on facts, preferences, and memories; exclude user/agent details
    - Match the input language (e.g., use Chinese for Chinese input)

    Input: Key points to remember about the user.`
}
