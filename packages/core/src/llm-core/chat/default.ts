import { Tool } from 'langchain/tools'
import { ChatHubBrowsingChain } from '../chain/browsing_chat_chain'
import { ChatHubChatChain } from '../chain/chat_chain'
import { ChatHubFunctionCallBrowsingChain } from '../chain/function_calling_browsing_chain'
import { ChatHubPluginChain } from '../chain/plugin_chat_chain'
import { Context, Schema, sleep } from 'koishi'
import { PlatformService } from '../platform/service'
import { CreateToolParams, ModelType } from '../platform/types'

export async function defaultFactory(ctx: Context, service: PlatformService) {
    ctx.on('chathub/chat-chain-added', async (service) => {
        ctx.schema.set('chat-mode', Schema.union(getChatChainNames(service)))
    })

    ctx.on('chathub/model-added', async (service) => {
        ctx.schema.set('model', Schema.union(getModelNames(service)))
    })

    ctx.on('chathub/embeddings-added', async (service) => {
        ctx.schema.set(
            'embeddings',
            Schema.union(
                service.getAllModels(ModelType.embeddings).map((name) => Schema.const(name))
            )
        )
    })

    ctx.on('chathub/vector-store-retriever-added', async (service) => {
        const vectorStoreRetrieverNames = service
            .getVectorStoreRetrievers()
            .map((name) => Schema.const(name))

        ctx.schema.set('vector-store', Schema.union(vectorStoreRetrieverNames))
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
            const tools = await selectAndCreateTools(
                service,
                (name) => name.includes('search') || name.includes('web-browser'),
                {
                    model: params.model,
                    embeddings: params.embeddings
                }
            )

            const model = params.model
            const options = {
                systemPrompts: params.systemPrompt,
                botName: params.botName,
                embeddings: params.embeddings,
                historyMemory: params.historyMemory,
                longMemory: params.longMemory
            }

            if (
                (model._llmType() === 'openai' && model.modelName.includes('0613')) ||
                model.modelName.includes('qwen')
            ) {
                return ChatHubFunctionCallBrowsingChain.fromLLMAndTools(model, tools, options)
            } else {
                return ChatHubBrowsingChain.fromLLMAndTools(model, tools, options)
            }
        }
    )

    service.registerChatChain('plugin', '插件模式（基于 LangChain 的 Agent）', async (params) => {
        return ChatHubPluginChain.fromLLMAndTools(
            params.model,
            await selectAndCreateTools(service, (_) => true, {
                model: params.model,
                embeddings: params.embeddings
            }),
            {
                systemPrompts: params.systemPrompt,
                historyMemory: params.historyMemory
            }
        )
    })
}

function selectAndCreateTools(
    service: PlatformService,
    filter: (name: string) => boolean,
    params: CreateToolParams
): Promise<Tool[]> {
    const tools = service.getTools().filter(filter)

    return Promise.all(tools.map((name) => service.createTool(name, params)))
}

function getChatChainNames(service: PlatformService) {
    return service
        .getChatChains()
        .map((info) => Schema.const(info.name).description(info.description ?? info.name))
}

function getModelNames(service: PlatformService) {
    return service
        .getAllModels(ModelType.llm)
        .map((model) => Schema.const(model).description(model))
}
