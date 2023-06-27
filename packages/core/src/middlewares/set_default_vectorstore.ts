import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { getKeysCache } from "../index"

const logger = createLogger("@dingyi222666/chathub/middlewares/set_default_model")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("set_default_vectorstore", async (session, context) => {

        const { command, options } = context

        if (command !== "set_vector_store") return ChainMiddlewareRunStatus.SKIPPED

        const vectorStoreProviders = await listAllVectorStoreProviders()

        const { setVectorStore } = options

        if (!setVectorStore) {
            context.message = "你可以使用 chathub.setvectorstore <model> 来设置默认使用的向量数据库"
        }


        const targetVectorStoreProviders = vectorStoreProviders.filter((vectorStoreProvider) => {
            return vectorStoreProvider.name.includes(setVectorStore)
        })

        for (let i = 0; i < targetVectorStoreProviders.length; i++) {
            const vectorStoreProvider = targetVectorStoreProviders[i]
            if (vectorStoreProvider.name === setVectorStore) {
                // clear other models
                targetVectorStoreProviders.splice(0, i)
                targetVectorStoreProviders.splice(1, targetVectorStoreProviders.length - 1)
                break
            }
        }

        if (targetVectorStoreProviders.length > 1) {
            const buffer: string[] = []

            buffer.push("基于你的输入，找到了以下向量数据库：\n")

            for (const vectorStoreProvider of targetVectorStoreProviders) {
                buffer.push(vectorStoreProvider.name)
            }

            buffer.push("请输入更精确的向量数据库名称以避免歧义")

            buffer.push("例如：chathub.setvectorstore " + targetVectorStoreProviders[0].name)

            context.message = buffer.join("\n")

        } else if (targetVectorStoreProviders.length === 0) {
            context.message = "找不到对应的向量数据库，请检查名称是否正确"
        }

        const targetProviderName = targetVectorStoreProviders[0].name

        const keysCache = getKeysCache()

        await keysCache.set("default-vector-store", targetProviderName)

        await session.send(`已将默认向量数据库设置为 ${targetProviderName}，(将自动重启插件应用更改)`)

        config.defaultVectorStore = targetProviderName
        ctx.scope.update(config, true)

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

export async function listAllVectorStoreProviders() {
    return await Factory.selectVectorStoreRetrieverProviders(async () => true)
}



declare module '../chain' {
    interface ChainMiddlewareName {
        "set_default_vectorstore": never
    }

    interface ChainMiddlewareContextOptions {
        setVectorStore?: string
    }
}