import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { ModelProvider } from '../llm-core/model/base';

const logger = createLogger("@dingyi222666/chathub/middlewares/list_all_model")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("list_all_model", async (session, context) => {

        const { command } = context

        if (command !== "listModel") return ChainMiddlewareRunStatus.SKIPPED

        const buffer = ["以下是目前可用的模型列表"]

        const modelProviders = await Factory.selectModelProviders(async () => true)

        for (const provider of modelProviders) {

            const models = await provider.listModels()

            for (const model of models) {
                buffer.push(provider.name + '/' + model)
            }
        }

        buffer.push("\n你可以使用 chathub.setmodel <model> 来设置默认使用的模型")

        context.message = buffer.join("\n")

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "list_all_model": never
    }
}