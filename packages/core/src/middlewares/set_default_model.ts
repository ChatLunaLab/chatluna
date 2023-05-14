import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { Factory } from '@dingyi222666/chathub-llm-core/lib/chat/factory';
import { buffer } from 'stream/consumers';

const logger = createLogger("@dingyi222666/chathub-llm-core/middlewares/list_all_model")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("set_default_model", async (session, context) => {

        const { command, options } = context

        if (command !== "setDefaultModel") return true

        const models = await listAllModel(ctx)

        const targetSetModel = options.setModel
        const splited = targetSetModel.split("/")

        const targetModel = models.filter((model) => {
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

            buffer.push("请输入更精确的模型名称以避免歧义")

            buffer.push(`例如：${buffer[1].split("/")[0]}/${buffer[1].split("/")[1]}`)

            context.message = buffer.join("")

            return false
        }

        const targetModelInfo = targetModel[0]

        const targetFullModelName = `${targetModelInfo.providerName}/${targetModelInfo.models.find(model => model == splited[1] || splited.length === 1 && model == splited[0])}`

        options.conversationInfo.model = targetFullModelName

        await ctx.database.upsert("chathub_conversation_info", [options.conversationInfo])

        context.message = `已将默认模型设置为 ${targetFullModelName}, 快来找我聊天吧！`
        return false
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