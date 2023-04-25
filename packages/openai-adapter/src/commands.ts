
import { Context } from 'koishi';
import OpenAIAdapter from '.';
import { buildTextElement, replyMessage } from '@dingyi222666/koishi-plugin-chathub';

const modelsMap = {
    "text-davinci-003": ["GPT-3", "达芬奇", "davinci", "GPT3", "text-davinci-003"],
    "gpt-3.5-turbo": ["GPT-3.5", "GPT3.5", "ChatGPT", "gpt-3.5-turbo"]
}


export default function apply(ctx: Context, config: OpenAIAdapter.Config) {

    ctx.command('chathub.openai.switchModel <model:text>', '切换OpenAI适配器的模型')
        .alias("切换openai模型")
        .action(async ({ session }, model) => {
            const resolvedModel = resolveModel(model)
            if (resolvedModel == config.chatModel) {
                await replyMessage(ctx, session, buildTextElement(`当前的OpenAI模型已为 ${config.chatModel}`))
                return
            }

            config.chatModel = resolvedModel
            ctx.scope.update(config, true)

            await replyMessage(ctx, session, buildTextElement(`已切换到OpenAI模型 ${config.chatModel}`))
        })

    ctx.command('chathub.openai.listModels', '列出所有OpenAI API 已支持的模型')
        .alias("列出可用的openai模型")
        .action(async ({ session }) => {
            const models = Object.keys(modelsMap)
            const modelList = models.map(model => {
                return `${modelsMap[model][0]}`
            }).join("\n")

            await replyMessage(ctx, session, buildTextElement(`目前已支持的OpenAI模型有：\n${modelList}`))
        })
}

function resolveModel(model: string) {
    model = model.toLowerCase()
    for (const key in modelsMap) {
        if ((modelsMap[key] as string).toLocaleLowerCase().includes(model)) return key
    }
    return model
}