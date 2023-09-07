import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { CacheMap } from '../utils/queue';



const logger = createLogger()


export function apply(ctx: Context, config: Config, chain: ChatChain) {

    const cacheMap = new CacheMap<string[]>()

    const service = ctx.chathub.platform

    chain.middleware("list_all_vectorstore", async (session, context) => {

        let { command, options: { page, limit } } = context

        if (command !== "list_vector_store") return ChainMiddlewareRunStatus.SKIPPED
        const buffer: string[] = ["以下是目前可用的向量数据库列表："]
       
        let vectorStoreProviders = service.getVectorStoreRetrievers()

        await cacheMap.set("default", vectorStoreProviders, (a, b) => {
            if (a.length !== b.length) return false
            const sortedA = a.sort()
            const sortedB = b.sort()

            return sortedA.every((value, index) => value === sortedB[index])
        })

        vectorStoreProviders = await cacheMap.get("default")

        const rangeVectorStoreProviders = vectorStoreProviders.slice((page - 1) * limit, Math.min(vectorStoreProviders.length, page * limit))

        for (const vectorStore of rangeVectorStoreProviders) {
            buffer.push(vectorStore)
        }

        buffer.push("\n你可以使用 chathub.vectorstore.set <model> 来设置默认使用的向量数据库(如果没有任何向量数据库，会使用存储在内存里的向量数据库（不保存）)")

        buffer.push(`\n当前为第 ${page} / ${Math.ceil(vectorStoreProviders.length / limit)} 页`)

        context.message = buffer.join("\n")

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "list_all_vectorstore": never
    }
}