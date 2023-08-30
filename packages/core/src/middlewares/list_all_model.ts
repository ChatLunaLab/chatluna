import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';

import { ModelType } from '../llm-core/platform/types';

const logger = createLogger()


export function apply(ctx: Context, config: Config, chain: ChatChain) {

    const services = ctx.chathub.platform

    chain.middleware("list_all_model", async (session, context) => {

        const { command } = context

        if (command !== "list_model") return ChainMiddlewareRunStatus.SKIPPED

        const buffer: string[][] = [["以下是目前可用的模型列表\n"]]
        let currentBuffer = buffer[0]

        const models = services.getAllModels(ModelType.llm)

        let modelCount = 0

        for (const model of models) {
            modelCount++

            currentBuffer.push(model)

            if (modelCount % 15 === 0) {
                currentBuffer = []
                buffer.push(currentBuffer)
            }
        }

        buffer.push(["\n你可以使用 chathub.room.set -m <model> 来设置默认使用的模型"])

        context.message = buffer.map(line => line.join("\n")).map(text => [h.text(text)])

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "list_all_model": never
    }
}