import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { getPlatformService } from '..';
import { ModelType } from '../llm-core/platform/types';
import { parseRawModelName } from '../llm-core/utils/count_tokens';


const logger = createLogger()


export function apply(ctx: Context, config: Config, chain: ChatChain) {

    const service = getPlatformService()

    chain.middleware("set_default_embeddings", async (session, context) => {

        const { command, options } = context

        if (command !== "set_embeddings") return ChainMiddlewareRunStatus.SKIPPED


        const { setEmbeddings } = options

        if (!setEmbeddings) {
            context.message = "你可以使用 chathub.embeddings.set <model> 来设置默认使用的嵌入模型"

            return ChainMiddlewareRunStatus.STOP
        }


        const embeddings = service.getAllModels(ModelType.embeddings)

        const [platform, modelName] = parseRawModelName(setEmbeddings)

        const targetEmbeddings = embeddings.filter((embeddingsName) => {
            return embeddingsName.includes(modelName)
        })


        if (targetEmbeddings.length > 1) {
            const buffer: string[] = []

            buffer.push("基于你的输入，找到了以下嵌入模型：\n")

            for (const embedding of targetEmbeddings) {
                buffer.push(embedding)
            }

            buffer.push("请输入更精确的嵌入模型名称以避免歧义")

            buffer.push("例如：chathub.embeddings.set " + targetEmbeddings[0])

            context.message = buffer.join("\n")

        } else if (targetEmbeddings.length === 0) {
            context.message = "找不到对应的嵌入模型，请检查输入是否正确"
        }

        const fullName = platform + "/" + targetEmbeddings[0]

        await context.send(`已将默认嵌入模型设置为 ${fullName} (将自动重启插件应用更改)`)

        config.defaultEmbeddings = fullName
        ctx.scope.update(config, true)

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}



export interface EmbeddingsInfo {
    providerName: string
    model: string
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "set_default_embeddings": never
    }

    interface ChainMiddlewareContextOptions {
        setEmbeddings?: string
    }
}