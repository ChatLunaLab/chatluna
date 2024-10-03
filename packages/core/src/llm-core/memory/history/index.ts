import { Context, Dict } from 'koishi'
import { Config, logger } from 'koishi-plugin-chatluna'
import { VectorStore, VectorStoreRetriever } from '@langchain/core/vectorstores'
import { ChatInterface } from 'koishi-plugin-chatluna/llm-core/chat/app'
import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { ScoreThresholdRetriever } from 'langchain/retrievers/score_threshold'
import { inMemoryVectorStoreRetrieverProvider } from 'koishi-plugin-chatluna/llm-core/model/in_memory'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/model/base'

export function apply(ctx: Context, config: Config): void {
    if (!config.longMemory) {
        return undefined
    }

    let longMemoryCache: Dict<VectorStoreRetriever> = {}

    ctx.on(
        'chatluna/before-chat',
        async (conversationId, message, promptVariables, chatInterface) => {
            const chatMode = chatInterface.chatMode

            if (chatMode === 'plugin') {
                return
            }

            const longMemoryId = resolveLongMemoryId(
                ctx,
                message,
                conversationId
            )

            let retriever = longMemoryCache[longMemoryId]

            if (!retriever) {
                retriever = await createVectorStoreRetriever(
                    ctx,
                    config,
                    chatInterface,
                    longMemoryId
                )
            }

            const memory = await retriever.invoke(message.content as string)

            logger?.debug(`Long memory: ${memory}`)

            promptVariables['long_memory'] = memory
        }
    )

    ctx.on(
        'chatluna/after-chat',
        async (
            conversationId,
            sourceMessage,
            _,
            promptVariables,
            chatInterface
        ) => {
            const chatMode = chatInterface.chatMode

            if (chatMode === 'plugin') {
                return undefined
            }

            if (config.longMemoryExtractModel === '无') {
                logger?.warn(
                    'Long memory extract model is not set, skip long memory'
                )
                return undefined
            }

            const longMemoryId = resolveLongMemoryId(
                ctx,
                sourceMessage,
                conversationId
            )

            const chatCount = promptVariables['chatCount'] as number

            if (chatCount % config.longMemoryInterval !== 0) {
                return undefined
            }

            const retriever = longMemoryCache[longMemoryId]

            if (!retriever) {
                logger?.warn(`Long memory not found: ${longMemoryId}`)
                return undefined
            }

            const chatHistory = await selectChatHistory(
                chatInterface,
                sourceMessage.id ?? undefined,
                config.longMemoryInterval
            )

            const preset = await chatInterface.preset

            const input = (
                preset.config?.longMemoryExtractPrompt ?? LONG_MEMORY_PROMPT
            ).replaceAll('{user_input}', chatHistory)

            const messages: BaseMessage[] = [
                ...preset.messages,
                new HumanMessage(input)
            ]

            const [platform, modelName] = parseRawModelName(
                config.longMemoryExtractModel
            )

            const model = (await ctx.chatluna.createChatModel(
                platform,
                modelName
            )) as ChatLunaChatModel

            const result = await model.invoke(messages)

            logger?.debug(`Long memory extract: ${result.content}`)

            const vectorStore = retriever.vectorStore as VectorStore

            vectorStore.addDocuments(
                [
                    {
                        pageContent: result.content as string,
                        metadata: {
                            source: 'long_memory'
                        }
                    }
                ],
                {}
            )

            if (vectorStore instanceof ChatLunaSaveableVectorStore) {
                logger?.debug('saving vector store')
                await vectorStore.save()
            }
        }
    )

    ctx.on(
        'chatluna/clear-chat-history',
        async (conversationId, chatInterface) => {
            // clear all
            longMemoryCache = {}
        }
    )
}

function resolveLongMemoryId(
    ctx: Context,
    message: HumanMessage,
    conversationId: string
) {
    const preset = message.additional_kwargs?.preset as string

    if (!preset) {
        return conversationId
    }

    const userId = message.id

    return `${userId}-${preset}`
}

async function createVectorStoreRetriever(
    ctx: Context,
    config: Config,
    chatInterface: ChatInterface,
    longMemoryId: string
) {
    let vectorStoreRetriever:
        | ScoreThresholdRetriever<VectorStore>
        | VectorStoreRetriever<VectorStore>

    const embeddings = chatInterface.embeddings

    if (
        this._input.longMemory !== true ||
        (this._input.chatMode !== 'chat' && this._input.chatMode !== 'browsing')
    ) {
        vectorStoreRetriever =
            await inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever(
                {
                    embeddings
                }
            )
    } else if (this._input.vectorStoreName == null) {
        logger?.warn(
            'Vector store is empty, falling back to fake vector store. Try check your config.'
        )

        vectorStoreRetriever =
            await inMemoryVectorStoreRetrieverProvider.createVectorStoreRetriever(
                {
                    embeddings
                }
            )
    } else {
        const store = await ctx.chatluna.platform.createVectorStore(
            this._input.vectorStoreName,
            {
                embeddings,
                key: longMemoryId
            }
        )

        /* store.asRetriever({
        k: 20,
        searchType: 'similarity'
    }) */

        const retriever = ScoreThresholdRetriever.fromVectorStore(store, {
            minSimilarityScore: this._input.longMemorySimilarity, // Finds results with at least this similarity score
            maxK: 30, // The maximum K value to use. Use it based to your chunk size to make sure you don't run out of tokens
            kIncrement: 2, // How much to increase K by each time. It'll fetch N results, then N + kIncrement, then N + kIncrement * 2, etc.,
            searchType: 'mmr'
        })

        vectorStoreRetriever = retriever
    }

    return vectorStoreRetriever
}

async function selectChatHistory(
    chatInterface: ChatInterface,
    id: string,
    count: number
) {
    const selectHistoryLength = Math.max(4, count * 2)

    const chatHistory = await chatInterface.chatHistory.getMessages()

    const finalHistory: BaseMessage[] = []

    for (let i = chatHistory.length - 1; i >= 0; i--) {
        const chatMessage = chatHistory[i]

        if (chatMessage.id !== id) {
            continue
        }

        if (chatMessage._getType() === 'human' && chatMessage.id === id) {
            const aiMessage = chatHistory[i + 1]
            if (aiMessage) finalHistory.unshift(aiMessage)
            finalHistory.unshift(chatMessage)

            continue
        }
    }

    const selectChatHistory = finalHistory
        .slice(-selectHistoryLength)
        .map((chatMessage) => {
            if (chatMessage._getType() === 'human') {
                return `user: ${chatMessage.content}`
            } else if (chatMessage._getType() === 'ai') {
                return `your: ${chatMessage.content}`
            } else if (chatMessage._getType() === 'system') {
                return `System: ${chatMessage.content}`
            } else {
                return `${chatMessage.content}`
            }
        })
        .join('\n')

    logger?.debug('select chat history for id %s: %s', id, selectChatHistory)

    return selectChatHistory
}

const LONG_MEMORY_PROMPT = `
Deduce the facts, preferences, and memories from the provided text.
Just return the facts, preferences, and memories in bullet points:
Natural language chat history: {user_input}

Constraint for deducing facts, preferences, and memories:
- The facts, preferences, and memories should be concise and informative.
- Don't start by "The person likes Pizza". Instead, start with "Likes Pizza".
- Don't remember the user/agent details provided. Only remember the facts, preferences, and memories.
- The output language should be the same as the input language. For example, if the input language is Chinese, the output language should also be Chinese.

Deduced facts, preferences, and memories:`
