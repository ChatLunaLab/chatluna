import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { ModelProvider } from '../llm-core/model/base';

const logger = createLogger("@dingyi222666/chathub/middlewares/list_all_model")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("list_all_model", async (session, context) => {

        const { command } = context

        if (command !== "list_model") return ChainMiddlewareRunStatus.SKIPPED

        const buffer: string[][] = [["以下是目前可用的模型列表"]]
        let currentBuffer = buffer[0]

        const modelProviders = await Factory.selectModelProviders(async () => true)

        let modelCount = 0
        for (const provider of modelProviders) {

            const models = await provider.listModels()

            for (const model of models) {
                modelCount++

                currentBuffer.push(modelCount.toString() + ". " + provider.name + '/' + model)

                if (modelCount % 10 === 0) {
                    currentBuffer = []
                    buffer.push(currentBuffer)
                }
            }
        }

        buffer.push(["\n你可以使用 chathub.setmodel <model> 来设置默认使用的模型"])

        context.message = buffer.map(line => line.join("\n")).map(text => [h.text(text)])

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "list_all_model": never
    }
}