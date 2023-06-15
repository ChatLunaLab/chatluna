import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { ModelProvider } from '../llm-core/model/base';

const logger = createLogger("@dingyi222666/chathub/middlewares/list_all_model")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("list_all_vectorstore", async (session, context) => {

        const { command } = context

        if (command !== "list_vectorStore") return ChainMiddlewareRunStatus.SKIPPED

        const buffer = ["以下是目前可用的向量数据库列表"]

        const vectorStoreProviders = await Factory.selectVectorStoreRetrieverProviders(async () => true)

        for (const provider of vectorStoreProviders) {
            buffer.push(provider.name)
        }

        buffer.push("\n你可以使用 chathub.setvectorstore <model> 来设置默认使用的向量数据库(如果没有任何向量数据库，会使用存储在内存里的向量数据库（不保存））")

        context.message = buffer.join("\n")

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "list_all_vectorstore": never
    }
}