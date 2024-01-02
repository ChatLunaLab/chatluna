import { ChatHubChatChain } from '../chain/chat_chain'
import { ChatLunaPluginChain } from '../chain/plugin_chat_chain'
import { Context, Schema } from 'koishi'
import { PlatformService } from '../platform/service'
import { ChatHubTool, ModelType } from '../platform/types'
import { logger } from '../..'
import { ChatLunaBrowsingChain } from '../chain/browsing_chain'
import { Tool } from 'langchain/tools'

export async function defaultFactory(ctx: Context, service: PlatformService) {
    ctx.on('chatluna/chat-chain-added', async (service) => {
        updateChatChains(ctx, service)
    })

    ctx.on('chatluna/chat-chain-removed', async (service) => {
        updateChatChains(ctx, service)
    })

    ctx.on('chatluna/model-added', async (service) => {
        updateModels(ctx, service)
    })

    ctx.on('chatluna/model-removed', async (service) => {
        updateModels(ctx, service)
    })

    ctx.on('chatluna/embeddings-added', async (service) => {
        updateEmbeddings(ctx, service)
    })

    ctx.on('chatluna/embeddings-removed', async (service) => {
        updateEmbeddings(ctx, service)
    })

    ctx.on('chatluna/vector-store-added', async (service) => {
        updateVectorStores(ctx, service)
    })

    ctx.on('chatluna/vector-store-removed', async (service) => {
        updateVectorStores(ctx, service)
    })

    ctx.on('chatluna/tool-updated', async (service) => {
        for (const wrapper of ctx.chatluna.getCachedInterfaceWrappers()) {
            wrapper
                .getCacheConversations()
                .filter(
                    ([_, conversation]) =>
                        conversation.room.chatMode === 'plugin' ||
                        conversation.room.chatMode === 'browsing'
                )
                .forEach(([id]) => {
                    logger?.debug(`Clearing cache for room ${id}`)
                    wrapper.clear(id)
                })
        }
    })

    service.registerChatChain('chat', '聊天模式', async (params) => {
        return ChatHubChatChain.fromLLM(
            // TODO: remove ??
            params.model,
            {
                botName: params.botName,
                longMemory: params.longMemory,
                historyMemory: params.historyMemory,
                systemPrompts: params.systemPrompt
            }
        )
    })

    service.registerChatChain(
        'browsing',
        'Browsing 模式，可以从外部获取信息',
        async (params) => {
            const tools = await Promise.all(
                getTools(
                    service,
                    (name) => name === 'web-search' || name === 'web-browser'
                ).map((tool) =>
                    tool.createTool({
                        model: params.model,
                        embeddings: params.embeddings
                    })
                )
            )

            const model = params.model
            const options = {
                systemPrompts: params.systemPrompt,
                botName: params.botName,
                embeddings: params.embeddings,
                historyMemory: params.historyMemory,
                longMemory: params.longMemory
            }

            return ChatLunaBrowsingChain.fromLLMAndTools(
                model,
                // only select web-search
                tools as Tool[],
                options
            )
        }
    )

    service.registerChatChain(
        'plugin',
        '插件模式（基于 LangChain 的 Agent）',
        async (params) => {
            return ChatLunaPluginChain.fromLLMAndTools(
                params.model,
                getTools(service, (_) => true),
                {
                    systemPrompts: params.systemPrompt,
                    historyMemory: params.historyMemory,
                    embeddings: params.embeddings
                }
            )
        }
    )
}

function updateModels(ctx: Context, service: PlatformService) {
    ctx.schema.set('model', Schema.union(getModelNames(service)))
}

function updateChatChains(ctx: Context, service: PlatformService) {
    ctx.schema.set('chat-mode', Schema.union(getChatChainNames(service)))
}

function updateEmbeddings(ctx: Context, service: PlatformService) {
    ctx.schema.set(
        'embeddings',
        Schema.union(getModelNames(service, ModelType.embeddings))
    )
}

function updateVectorStores(ctx: Context, service: PlatformService) {
    const vectorStoreRetrieverNames = service
        .getVectorStoreRetrievers()
        .concat('无')
        .map((name) => Schema.const(name))

    ctx.schema.set('vector-store', Schema.union(vectorStoreRetrieverNames))
}

function getTools(
    service: PlatformService,
    filter: (name: string) => boolean
): ChatHubTool[] {
    const tools = service.getTools().filter(filter)

    return tools.map((name) => service.getTool(name))
}

function getChatChainNames(service: PlatformService) {
    return service
        .getChatChains()
        .map((info) =>
            Schema.const(info.name).description(info.description ?? info.name)
        )
}

function getModelNames(
    service: PlatformService,
    type: ModelType = ModelType.llm
) {
    const models = service.getAllModels(type).concat('无')

    return models.map((model) => Schema.const(model).description(model))
}
