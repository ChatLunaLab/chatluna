
import { Context } from 'koishi';
import OpenAIAdapter from '.';
import { buildTextElement, checkInBlackList, replyMessage } from '@dingyi222666/koishi-plugin-chathub';

const modelsMap = {
    ChatGPT: "ChatGPT",
    Dragonfly: "Dragonfly",
    ["GPT-4"]: "GPT-4",
    ["Claude-instant"]: "Claude",
    ["Claude+"]: "Claude+",
    NeevaAI: "NeevaAI",
    Sage: "Sage",
}
const modelsDescription = {
    ["GPT-4"]: "有限额 (1条消息 / 24小时)",
    ["Claude-instant"]: "有限额 (3条消息 / 24小时)"
}


export default function apply(ctx: Context, config: OpenAIAdapter.Config) {

    ctx.command('chathub.poe.switchModel <model:text>', '切换poe适配器的模型')
        .alias("切换poe模型")
        .action(async ({ session }, model) => {
            if (await checkInBlackList(ctx, session) === true) return
          
            const resolvedModel = resolveModel(model)
            if (resolvedModel == config.model) {
                await replyMessage(ctx, session, buildTextElement(`当前的poe模型已为 ${config.model}`))
                return
            }

            config.model = resolvedModel
            ctx.scope.update(config, true)

            await replyMessage(ctx, session, buildTextElement(`已切换到poe模型 ${config.model}`))
        })

    ctx.command('chathub.poe.listModels', '列出所有poe.com已支持的模型')
        .alias("列出可用的poe模型")
        .action(async ({ session }) => {                                                                
            if (await checkInBlackList(ctx, session) === true) return
          
            const models = Object.keys(modelsMap)
            const modelList = models.map(model => {
                return `${modelsMap[model]}${queryDescription(model)}`
            }).join("\n")

            await replyMessage(ctx, session, buildTextElement(`目前已支持的poe模型有：\n${modelList}`))
        })
}

function resolveModel(model: string) {
    model = model.toLowerCase()
    for (const key in modelsMap) {
        if ((modelsMap[key] as string).toLocaleLowerCase().includes(model)) return key
    }
    return model
}

function queryDescription(model: string) {
    const description = modelsDescription[model]
    if (description) return `: ${description}`
    return ""
}