import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chain';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { Factory } from '@dingyi222666/chathub-llm-core/lib/chat/factory';
import { getKeysCache } from "../index"
import { CONNECTING } from 'ws';

const logger = createLogger("@dingyi222666/chathub/middlewares/set_default_model")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("set_default_model", async (session, context) => {

        const { command, options } = context

        if (command !== "setDefaultModel") return ChainMiddlewareRunStatus.SKIPPED

        const models = await listAllModel(ctx)

        const targetSetModel = options.setModel
        const splited = targetSetModel.split("/")

        logger.debug(`[set_default_model] splited: ${JSON.stringify(splited)}`)

        const targetModel = models.filter((model) => {
            logger.debug(`[set_default_model] inModels: ${JSON.stringify(model.models)}, ${model.models.includes(splited[0])}`)
            return (splited[0] === model.providerName && model.models.includes(splited[1])) || (splited.length === 1 &&
                model.models.includes(splited[0]))
        })

        if (targetModel.length > 1) {

            const buffer = []
            buffer.push("基于你的输入，找到了以下模型：\n")

            targetModel.forEach((model) => {
                const subModel = model.models.find((subModel) => {
                    return subModel === splited[1] || (splited.length === 1 && subModel === splited[0])
                })

                buffer.push(`\t${model.providerName}/${subModel}\n`)
            })

            buffer.push("请输入更精确的模型名称以避免歧义\n")

            buffer.push(`例如：${buffer[1].split("/")[0]}/${buffer[1].split("/")[1]}`)

            context.message = buffer.join("")

            return ChainMiddlewareRunStatus.STOP
        } else if (targetModel.length === 0) {
            context.message = `未找到模型 ${targetSetModel}`
            return ChainMiddlewareRunStatus.STOP
        }

        const targetModelInfo = targetModel[0]

        const targetFullModelName = `${targetModelInfo.providerName}/${targetModelInfo.models.find(model => model == splited[1] || splited.length === 1 && model == splited[0])}`

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

    const promiseModelInfos = modelProviders.map(async (modelProvider) => {
        const models = await modelProvider.listModels()
        const recommendModel = await modelProvider.recommendModel()
        return {
            providerName: modelProvider.name,
            models,
            recommendModel
        }
    })

    return Promise.all(promiseModelInfos)
}

export interface ModelInfo {
    providerName: string
    models: string[]
    recommendModel: string
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "set_default_model": never
    }

    interface ChainMiddlewareContextOptions {
        setModel?: string
    }
}