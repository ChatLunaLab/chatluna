/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    fuzzyQuery,
    getMessageContent
} from 'koishi-plugin-chatluna/utils/string'
import { Config } from '..'
import type {
    Chain,
    DocumentConfig
} from 'koishi-plugin-chatluna-knowledge-chat'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.knowledge !== true) {
        return
    }

    ctx.plugin({
        apply: (ctx) => {
            plugin.registerTool('knowledge', {
                selector(history) {
                    return history.some(
                        (message) =>
                            message.content != null &&
                            fuzzyQuery(getMessageContent(message.content), [
                                '知识',
                                'knowledge',
                                '搜索',
                                '查找',
                                '了解',
                                '获取',
                                '？',
                                '？',
                                '查询',
                                'search'
                            ])
                    )
                },
                alwaysRecreate: false,

                async createTool(params, session) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return new KnowledgeTool(ctx, config.knowledgeId) as any
                }
            })
        },
        inject: ['chatluna_knowledge', 'database']
    })
}

export class KnowledgeTool extends Tool {
    name = 'knowledge'

    chain: ReturnType<Chain>

    constructor(
        public ctx: Context,
        private knowledgeId: string[]
    ) {
        super({})
    }

    /** @ignore */
    async _call(input: string) {
        try {
            if (!this.chain) {
                this.chain = await createSearchChain(this.ctx, this.knowledgeId)
            }

            const documents = await this.chain(input, [])

            return documents.map((document) => document.pageContent).join('\n')
        } catch (e) {
            this.ctx.logger.error(e)
            return `Search knowledge execution failed, because ${e.message}`
        }
    }

    description = `This tool queries a knowledge base to retrieve information on various topics. Use it to find facts, explanations, or answers to questions. The input should be a clear and specific query or question related to the desired information. For example:
    - "What is the capital of France?"
    - "Explain the process of photosynthesis"
    - "Who invented the telephone?"

    The tool will search the knowledge base and return relevant information based on the query.`
}

async function createSearchChain(
    ctx: Context,
    searchKnowledge: string[]
): Promise<ReturnType<Chain>> {
    const chatVectorStore = ctx.chatluna.config.defaultVectorStore
    const selectedKnowledge: DocumentConfig[] = []
    const config = ctx.chatluna_knowledge.config

    if (searchKnowledge) {
        const regex =
            typeof searchKnowledge === 'string'
                ? searchKnowledge
                : searchKnowledge.join('|')

        const knowledge = await ctx.database.get('chathub_knowledge', {
            name: {
                $regex: new RegExp(regex)
            },
            vector_storage: chatVectorStore
        })

        selectedKnowledge.push(...knowledge)
    } else {
        const knowledge = await ctx.database.get('chathub_knowledge', {
            name: config.defaultKnowledge
        })

        selectedKnowledge.push(...knowledge)
    }

    if (selectedKnowledge.length === 0) {
        ctx.logger.warn('No knowledge selected')
        return null
    } else {
        ctx.logger.debug(
            `Selected knowledge: ${JSON.stringify(selectedKnowledge)}`
        )
    }

    const vectorStores = await Promise.all(
        selectedKnowledge.map((knowledge) =>
            ctx.chatluna_knowledge.loadVectorStore(knowledge.path)
        )
    )

    const retriever = ctx.chatluna_knowledge.createRetriever(vectorStores)

    if (!config.model) {
        throw new ChatLunaError(
            ChatLunaErrorCode.KNOWLEDGE_CONFIG_INVALID,
            new Error('model is not set')
        )
    }

    const [platform, modelName] = parseRawModelName(config?.model)

    const model = await ctx.chatluna
        .createChatModel(platform, modelName)
        .then((model) => model as ChatLunaChatModel)

    return ctx.chatluna_knowledge.chains[config.mode](model, retriever)
}
