import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { ModelProvider } from '../llm-core/model/base';

const logger = createLogger("@dingyi222666/chathub/middlewares/list_all_embeddings")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("list_all_embeddings", async (session, context) => {

        const { command } = context

        if (command !== "list_embeddings") return ChainMiddlewareRunStatus.SKIPPED

        const buffer = ["以下是目前可用的嵌入模型列表"]

        const embeddingsProviders = await Factory.selectEmbeddingProviders(async () => true)

        for (const provider of embeddingsProviders) {

            const models = await provider.listEmbeddings()

            for (const model of models) {
                buffer.push(provider.name + '/' + model)
            }
        }

        buffer.push("\n你可以使用 chathub.setembeddings <model> 来设置默认使用的嵌入模型")

        context.message = buffer.join("\n")

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "list_all_embeddings": never
    }
}