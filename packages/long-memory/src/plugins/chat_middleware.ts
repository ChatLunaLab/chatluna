import { Context } from 'koishi'
import {
    Config,
    logger,
    MemoryRetrievalLayerType
} from 'koishi-plugin-chatluna-long-memory'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import {
    extractMemoriesFromChat,
    generateNewQuestion,
    selectChatHistory
} from '../utils/chat-history'
import { enhancedMemoryToDocument, isMemoryExpired } from '../utils/memory'

export async function apply(ctx: Context, config: Config) {
    const model = await ctx.chatluna.createChatModel(
        config.longMemoryExtractModel
    )

    // 在聊天前处理长期记忆
    ctx.on(
        'chatluna/before-chat',
        async (conversationId, message, promptVariables, chatInterface) => {
            if (ctx.chatluna_long_memory.defaultLayerTypes.length === 0) {
                return
            }

            const presetId = message.additional_kwargs?.preset as string

            const userId = message.id

            const layers = await ctx.chatluna_long_memory.initMemoryLayers(
                conversationId,
                {
                    presetId,
                    userId
                },
                ctx.chatluna_long_memory.defaultLayerTypes
            )

            let searchContent =
                (message.additional_kwargs['raw_content'] as string | null) ??
                getMessageContent(message.content)

            if (
                config.longMemoryQueryRewrite /* &&
                layers.some((layer) => !isBasicLayer(layer)) */
            ) {
                const chatHistory = await selectChatHistory(
                    await chatInterface.chatHistory
                        .getMessages()
                        .then((messages) => messages.concat(message)),
                    config.longMemoryExtractInterval
                )

                if (model.value != null) {
                    logger?.debug(
                        `Long memory search content: ${searchContent}, Chat history: ${JSON.stringify(
                            chatHistory
                        )}`
                    )

                    searchContent = await generateNewQuestion(
                        model,
                        chatHistory,
                        searchContent
                    )
                } else {
                    logger?.warn(
                        'LongMemoryExtractModel not configured or invalid, skip query rewrite.'
                    )
                }

                if (searchContent.trim().toLowerCase() === '[skip]') {
                    logger?.debug(
                        `Don't search long memory for user: ${message.id}. Because model response is [skip].`
                    )
                    return
                }
            }

            logger?.debug(`Long memory search: ${searchContent}`)

            // 使用记忆层检索记忆
            const memories = await Promise.all(
                layers.map((layer) => layer.retrieveMemory(searchContent))
            )

            // 过滤掉过期的记忆
            const validMemories = memories
                .flat()
                .filter((memory) => !isMemoryExpired(memory))

            logger?.debug(
                `Long memory retrieved: ${JSON.stringify(validMemories)}`
            )

            promptVariables['long_memory'] = validMemories.map(
                enhancedMemoryToDocument
            )
        }
    )

    // 在聊天后处理长期记忆
    ctx.on(
        'chatluna/after-chat',
        async (
            conversationId,
            sourceMessage,
            _,
            promptVariables,
            chatInterface
        ) => {
            if (model.value == null) {
                logger?.warn(
                    'Long memory extract model is not set, skip long memory'
                )
                return undefined
            }

            if (
                !ctx.chatluna_long_memory.defaultLayerTypes.includes(
                    MemoryRetrievalLayerType.USER
                )
            ) {
                logger?.warn(
                    `Long memory ${ctx.chatluna_long_memory.defaultLayerTypes.join(', ')} layer is not supported, only support user layer`
                )
                return undefined
            }

            const chatCount = promptVariables['chatCount'] as number

            if (chatCount % (config.longMemoryExtractInterval ?? 3) !== 0)
                return undefined

            const chatHistory = await selectChatHistory(
                await chatInterface.chatHistory.getMessages(),
                config.longMemoryExtractInterval
            )

            // 提取记忆
            const memories = await extractMemoriesFromChat(
                model,
                chatInterface,
                chatHistory
            )

            if (memories.length === 0) return

            // 添加记忆到记忆层
            await ctx.chatluna_long_memory.addMemories(conversationId, memories)
        }
    )
}
