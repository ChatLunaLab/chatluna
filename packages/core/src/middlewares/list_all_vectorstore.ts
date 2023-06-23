import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { ModelProvider } from '../llm-core/model/base';

const logger = createLogger("@dingyi222666/chathub/middlewares/list_all_vectorstore")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("list_all_vectorstore", async (session, context) => {

        const { command } = context

        if (command !== "list_vectorStore") return ChainMiddlewareRunStatus.SKIPPED
        const buffer: string[][] = [["以下是目前可用的向量数据库列表"]]
        let currentBuffer = buffer[0]

        const vectorStoreProviders = await Factory.selectVectorStoreRetrieverProviders(async () => true)

        let vectorStoreCount = 0
        for (const provider of vectorStoreProviders) {
            vectorStoreCount++

            currentBuffer.push(vectorStoreCount.toString() + ". " + provider.name)

            if (vectorStoreCount % 10 === 0) {
                currentBuffer = []
                buffer.push(currentBuffer)
            }
        }

        buffer.push(["\n你可以使用 chathub.setvectorstore <model> 来设置默认使用的向量数据库(如果没有任何向量数据库，会使用存储在内存里的向量数据库（不保存）)"])

        context.message = buffer.map(line => line.join("\n")).map(text => [h.text(text)])

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "list_all_vectorstore": never
    }
}