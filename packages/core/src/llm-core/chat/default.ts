import { ChatHubBrowsingChain } from '../chain/browsing_chat_chain'
import { ChatHubChatChain } from '../chain/chat_chain'
import { ChatHubFunctionCallBrowsingChain } from '../chain/function_calling_browsing_chain'
import { ChatHubPluginChain } from '../chain/plugin_chat_chain'
import { Context, Schema } from 'koishi'
import { PlatformService } from '../platform/service'
import { ChatHubTool, ModelType } from '../platform/types'

export async function defaultFactory(ctx: Context, service: PlatformService) {
    ctx.on('chathub/chat-chain-added', async (service) => {
        updateChatChains(ctx, service)
    })

    ctx.on('chathub/chat-chain-removed', async (service) => {
        updateChatChains(ctx, service)
    })

    ctx.on('chathub/model-added', async (service) => {
        updateModels(ctx, service)
    })

    ctx.on('chathub/model-removed', async (service) => {
        updateModels(ctx, service)
    })

    ctx.on('chathub/embeddings-added', async (service) => {
        updateEmbeddings(ctx, service)
    })

    ctx.on('chathub/embeddings-removed', async (service) => {
        updateEmbeddings(ctx, service)
    })

    ctx.on('chathub/vector-store-added', async (service) => {
        updateVectorStores(ctx, service)
    })

    ctx.on('chathub/vector-store-removed', async (service) => {
        updateVectorStores(ctx, service)
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
        '类 ChatGPT 的 Browsing 模式 （不稳定，仍在测试）',
        async (params) => {
            const tools = await getTools(
                service,
                (name) =>
                    name.includes('search') || name.includes('web-browser')
            )
                .then((tools) =>
                    tools.map((tool) =>
                        tool.createTool({
                            model: params.model,
                            embeddings: params.embeddings
                        })
                    )
                )
                .then((tools) => Promise.all(tools))

            const model = params.model
            const options = {
                systemPrompts: params.systemPrompt,
                botName: params.botName,
                embeddings: params.embeddings,
                historyMemory: params.historyMemory,
                longMemory: params.longMemory
            }

            if (
                (model._llmType() === 'openai' &&
                    model.modelName.includes('0613')) ||
                model.modelName.includes('qwen')
            ) {
                return ChatHubFunctionCallBrowsingChain.fromLLMAndTools(
                    model,
                    tools,
                    options
                )
            } else {
                return ChatHubBrowsingChain.fromLLMAndTools(
                    model,
                    tools,
                    options
                )
            }
        }
    )

    service.registerChatChain(
        'plugin',
        '插件模式（基于 LangChain 的 Agent）',
        async (params) => {
            return ChatHubPluginChain.fromLLMAndTools(
                params.model,
                await getTools(service, (_) => true),
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
): Promise<ChatHubTool[]> {
    const tools = service.getTools().filter(filter)

    return Promise.all(tools.map((name) => service.getTool(name)))
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
