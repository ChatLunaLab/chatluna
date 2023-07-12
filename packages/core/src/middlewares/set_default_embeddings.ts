import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '../llm-core/utils/logger';
import { Factory } from '../llm-core/chat/factory';
import { getKeysCache } from "../index"

const logger = createLogger("@dingyi222666/chathub/middlewares/set_default_model")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("set_default_embeddings", async (session, context) => {

        const { command, options } = context

        if (command !== "set_embeddings") return ChainMiddlewareRunStatus.SKIPPED

        const embeddings = await listAllEmbeddings()

        const { setEmbeddings } = options

        if (!setEmbeddings) {
            context.message = "你可以使用 chathub.setembeddings <model> 来设置默认使用的嵌入模型"

            return ChainMiddlewareRunStatus.STOP
        }

        const [providerName, model] = setEmbeddings.split(/(?<=^[^\/]+)\//)

        const targetEmbeddings = embeddings.filter((embedding) => {
            return (providerName === embedding.providerName && embedding.model.includes(model)) || embedding.model.includes(providerName)
        })

        for (let i = 0; i < targetEmbeddings.length; i++) {
            const embedding = targetEmbeddings[i]
            if (embedding.model === model && embedding.providerName === providerName || embedding.model === providerName) {
                // clear other models
                targetEmbeddings.splice(0, i)
                targetEmbeddings.splice(1, targetEmbeddings.length - 1)
                break
            }
        }

        if (targetEmbeddings.length > 1) {
            const buffer: string[] = []

            buffer.push("基于你的输入，找到了以下嵌入模型：\n")

            for (const embedding of targetEmbeddings) {
                buffer.push(embedding.providerName + '/' + embedding.model)
            }

            buffer.push("请输入更精确的嵌入模型名称以避免歧义")

            buffer.push("例如：chathub.setembeddings " + targetEmbeddings[0].providerName + "/" + targetEmbeddings[0].model)

            context.message = buffer.join("\n")

        } else if (targetEmbeddings.length === 0) {
            context.message = "找不到对应的嵌入模型，请检查输入是否正确"
        }

        const { providerName: targetProviderName, model: targetModel } = targetEmbeddings[0]


        const fullName = targetProviderName + "/" + targetModel

        await context.send(`已将默认嵌入模型设置为 ${fullName} (将自动重启插件应用更改)`)

        config.defaultEmbeddings = fullName
        ctx.scope.update(config, true)

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

export async function listAllEmbeddings(): Promise<EmbeddingsInfo[]> {
    const embeddingsProviders = await Factory.selectEmbeddingProviders(async () => true)

    const promiseEmbeddingsInfos = embeddingsProviders.flatMap(async (provider) => {
        const models = await provider.listEmbeddings()

        return models.map((model) => {
            return {
                providerName: provider.name,
                model
            }
        })
    })

    const result: EmbeddingsInfo[] = []

    for (const promiseEmbeddingsInfo of promiseEmbeddingsInfos) {
        const embeddingsInfo = await promiseEmbeddingsInfo
        result.push(...embeddingsInfo)
    }

    return result
}

export interface EmbeddingsInfo {
    providerName: string
    model: string
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "set_default_embeddings": never
    }

    interface ChainMiddlewareContextOptions {
        setEmbeddings?: string
    }
}