import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { ModelProvider } from '../llm-core/model/base';

const logger = createLogger("@dingyi222666/chathub/middlewares/list_all_embeddings")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("list_all_embeddings", async (session, context) => {

        const { command } = context

        if (command !== "list_embeddings") return ChainMiddlewareRunStatus.SKIPPED

        const buffer: string[][] = [["以下是目前可用的嵌入模型列表\n"]]
        let currentBuffer = buffer[0]

        const embeddingsProviders = await Factory.selectEmbeddingProviders(async () => true)

        let embeddingsCount = 0
        for (const provider of embeddingsProviders) {

            const models = await provider.listEmbeddings()

            for (const model of models) {
                embeddingsCount++

                currentBuffer.push(embeddingsCount.toString() + ". " + provider.name + '/' + model)

                if (embeddingsCount % 15 === 0) {
                    currentBuffer = []
                    buffer.push(currentBuffer)
                }
            }
        }

        buffer.push(["\n你可以使用 chathub.setembeddings <model> 来设置默认使用的嵌入模型"])

        context.message = buffer.map(line => line.join("\n")).map(text => [h.text(text)])

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "list_all_embeddings": never
    }
}