import { Tool } from 'langchain/tools'
import { ChatHubChain } from '../chain/base'
import { ChatHubBrowsingChain } from '../chain/browsing_chat_chain'
import { ChatHubChatChain } from '../chain/chat_chain'
import { ChatHubFunctionCallBrowsingChain } from '../chain/function_calling_browsing_chain'
import { ChatHubPluginChain } from '../chain/plugin_chat_chain'
import { ChatChainProvider, ChatHubBaseChatModel } from '../model/base'
import { Factory } from './factory'
import { Context, Schema, sleep } from 'koishi'
import { Embeddings } from 'langchain/embeddings/base'

export async function defaultFactory(ctx: Context) {

    Factory.on("chat-chain-provider-added", async (provider) => {
        await sleep(50)
        ctx.schema.set('chat-mode', Schema.union(await getChatChainNames()))
    })

    Factory.on('model-provider-added', async () => {
        await sleep(200)
        ctx.schema.set('model', Schema.union(await getModelNames()))
    })

    Factory.on("embeddings-provider-added", async () => {
        await sleep(200)
        const embeddingsProviders = await Factory.selectEmbeddingProviders(async _ => true)

        const embeddingsNames = (
            await Promise.all(
                embeddingsProviders.flatMap(
                    async provider => {
                        const listEmbeddings = await provider.listEmbeddings()

                        return listEmbeddings.map(subName => provider.name + "/" + subName)
                    })))
            .reduce((a, b) =>
                a.concat(b), [])

        ctx.schema.set('embeddings', Schema.union(embeddingsNames))
    })

    Factory.on("vector-store-retriever-provider-added", async () => {
        await sleep(200)
        const vectorStoreRetrieverProviders = await Factory.selectVectorStoreRetrieverProviders(async _ => true)

        const vectorStoreRetrieverNames = vectorStoreRetrieverProviders.map(provider => provider.name)

        ctx.schema.set('vector-store', Schema.union(vectorStoreRetrieverNames))
    })

    Factory.registerChatChainProvider(new class implements ChatChainProvider {
        name = "chat"
        description = "聊天模式"
        async create(params: Record<string, any>) {
            return ChatHubChatChain.fromLLM(
                params.model,
                {
                    botName: params.botName,
                    longMemory: params.longMemory,
                    historyMemory: params.historyMemory,
                    systemPrompts: params.systemPrompts,
                }
            )
        }
    })

    Factory.registerChatChainProvider(new class implements ChatChainProvider {
        name = "browsing"
        description = "类 ChatGPT 的 Browsing 模式 （不稳定，仍在测试）"
        async create(params: Record<string, any>) {
            const tools = await selectAndCreateTools((name) => name.includes("search") || name.includes("web-browser"), {
                model: params.model,
                embeddings: params.embeddings
            })

            const model = params.model as ChatHubBaseChatModel
            const options = {
                systemPrompts: params.systemPrompts,
                botName: params.botName,
                embeddings: params.embeddings,
                historyMemory: params.historyMemory,
                longMemory: params.longMemory
            }

            if (model._llmType() === "openai" && model._modelType().includes("0613")) {
                return ChatHubFunctionCallBrowsingChain.fromLLMAndTools(model,
                    tools, options)
            } else {
                return ChatHubBrowsingChain.fromLLMAndTools(
                    model,
                    tools, options)
            }
        }
    })

    Factory.registerChatChainProvider(new class implements ChatChainProvider {
        name = "plugin"
        description = "插件模式（基于 LangChain 的 Agent）"
        async create(params: Record<string, any>) {
            return ChatHubPluginChain.fromLLMAndTools(
                params.model,
                await selectAndCreateTools(_ => true, {
                    model: params.model, embeddings: params.embeddings
                }),
                {
                    systemPrompts: params.systemPrompts,
                    historyMemory: params.historyMemory,
                })
        }
    })

}

function selectAndCreateTools(filter: (name: string) => boolean, {
    model,
    embeddings }: {
        model: ChatHubBaseChatModel,
        embeddings: Embeddings
    }): Promise<Tool[]> {
    return Promise.all(Factory.selectToolProviders(filter).map(async (tool) => {
        return await tool.createTool({
            model: model,
            embeddings: embeddings,
        })
    }))
}

async function getChatChainNames() {
    const providers = await Factory.selectChatChainProviders(async (_) => true)
    return providers.map(provider =>
        Schema.const(provider.name).description(provider.description))
}

async function getModelNames() {
    const providers = await Factory.selectModelProviders(async (_) => true)
    const promises = providers.flatMap(async provider => {
        const models = await provider.listModels()
        return models.map(model => Schema.const(provider.name + "/" + model))
    })

    return (await Promise.all(promises)).reduce((a, b) => a.concat(b), [])
}