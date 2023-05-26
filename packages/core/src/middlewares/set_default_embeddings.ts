import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { Factory } from '@dingyi222666/chathub-llm-core/lib/chat/factory';
import { getKeysCache } from "../index"

const logger = createLogger("@dingyi222666/chathub/middlewares/set_default_model")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("set_default_embeddings", async (session, context) => {

        const { command, options } = context

        if (command !== "setEmbeddings") return ChainMiddlewareRunStatus.SKIPPED

        const models = await listAllModel(ctx)

        const targetSetModel = options.setModel
        const splited = targetSetModel.split("/")

        logger.debug(`[set_default_model] splited: ${JSON.stringify(splited)}`)

        const targetModels = models.filter((model) => {
            return (splited[0] === model.providerName && model.model.includes(splited[1])) != null || model.model.includes(splited[0]) != null
        })


        for (let i = 0; i < targetModels.length; i++) {
            const model = targetModels[i]
            if (model.model === splited?.[1] && model.providerName === splited?.[0] || model.model === splited[0]) {
                // clear other models
                targetModels.splice(0, i)
                targetModels.splice(1, targetModels.length - 1)
                break
            }
        }

        if (targetModels.length > 1) {
            const buffer:string[] = []
            buffer.push("基于你的输入，找到了以下模型：\n")

            targetModels.forEach((model) => {
                buffer.push(`\t${model.providerName}/${model.model}\n`)
            })

            buffer.push("请输入更精确的模型名称以避免歧义\n")

            buffer.push(`例如：${buffer[1].replace("\t",'')}`)

            context.message = buffer.join("")

            return ChainMiddlewareRunStatus.STOP
        } else if (targetModels.length === 0) {
            context.message = `未找到模型 ${targetSetModel}`
            return ChainMiddlewareRunStatus.STOP
        }

        const targetModelInfo = targetModels[0]

        const targetFullModelName = `${targetModelInfo.providerName}/${targetModelInfo.model}`

        const cache = getKeysCache()

        cache.set("defaultModel", targetFullModelName)

        options.conversationInfo.model = targetFullModelName

        await ctx.database.upsert("chathub_conversation_info", [options.conversationInfo])

        context.message = `已将默认模型设置为 ${targetFullModelName}, 快来找我聊天吧！`
        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

export async function listAllModel(ctx: Context): Promise<ModelInfo[]> {
    const modelProviders = await Factory.selectModelProviders(async () => true)

    const promiseModelInfos = modelProviders.flatMap(async (modelProvider) => {
        const models = await modelProvider.listModels()
        const recommendModel = await modelProvider.recommendModel()
        return models.map((model) => {
            return {
                providerName: modelProvider.name,
                model: model,
                recommendModel
            }
        })
    })

    const result: ModelInfo[] = []

    for (const promiseModelInfo of promiseModelInfos) {
        result.push(...(await promiseModelInfo))
    }

    return result
}

export interface ModelInfo {
    providerName: string
    model: string
    recommendModel: string
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "set_default_embeddings": never
    }

    interface ChainMiddlewareContextOptions {
        setModel?: string
    }
}