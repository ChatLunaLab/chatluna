import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { Factory } from '@dingyi222666/chathub-llm-core/lib/chat/factory';
import { ModelProvider } from '@dingyi222666/chathub-llm-core/lib/model/base';

const logger = createLogger("@dingyi222666/chathub/middlewares/list_all_model")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("list_all_embeddings", async (session, context) => {

        const { command } = context

        if (command !== "listEmbeddings") return ChainMiddlewareRunStatus.SKIPPED

        const buffer = ["以下是目前可用的嵌入模型列表"]

        const embeddingsProviders = await Factory.selectEmbeddingProviders(async () => true)

        for (const provider of embeddingsProviders) {

            const models = await provider.listEmbeddings()

            for (const model of models) {
                buffer.push(provider.name + '/' + model)
            }
        }

        buffer.push("\n你可以使用 chathub.setEmbedding <model> 来设置默认使用的嵌入模型")

        context.message = buffer.join("\n")

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "list_all_embeddings": never
    }
}