import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { getPlatformService } from '..';
import { ModelType } from '../llm-core/platform/types';

const logger = createLogger()


export function apply(ctx: Context, config: Config, chain: ChatChain) {

    const service = getPlatformService()

    chain.middleware("list_all_embeddings", async (session, context) => {

        const { command } = context

        if (command !== "list_embeddings") return ChainMiddlewareRunStatus.SKIPPED

        const buffer: string[][] = [["以下是目前可用的嵌入模型列表\n"]]
        let currentBuffer = buffer[0]

        const embeddingModels = service.getAllModels(ModelType.embeddings)

        let embeddingsCount = 0

        for (const model of embeddingModels) {
            embeddingsCount++

            currentBuffer.push(model)

            if (embeddingsCount % 15 === 0) {
                currentBuffer = []
                buffer.push(currentBuffer)
            }
        }


        buffer.push(["\n你可以使用 chathub.embeddings.set <model> 来设置默认使用的嵌入模型"])

        context.message = buffer.map(line => line.join("\n")).map(text => [h.text(text)])

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "list_all_embeddings": never
    }
}