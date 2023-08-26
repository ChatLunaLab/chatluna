import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'


const logger = createLogger('@dingyi222666/chathub-openai-adapter')

export function apply(ctx: Context, config: Config) { }


export interface Config extends ChatHubPlugin.Config {
    apiKey: string
    apiEndPoint: string
    maxTokens: number
    temperature: number
    presencePenalty: number
    frequencyPenalty: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,
    Schema.object({
        apiKey: Schema.string().role('secret').description('OpenAI 的 API Key').required(),
        apiEndPoint: Schema.string().description('请求 OpenAI API 的地址').default("https://api.openai.com/v1"),
    }).description('请求设置'),

    Schema.object({
        maxTokens: Schema.number().description('回复的最大 Token 数（16~4096，必须是16的倍数）（注意如果你目前使用的模型的最大 Token 为 8000 及以上的话才建议设置超过 512 token）')
            .min(16).max(4096).step(16).default(256),
        temperature: Schema.percent().description('回复温度，越高越随机')
            .min(0).max(1).step(0.1).default(0.8),
        presencePenalty: Schema.number().description('重复惩罚，越高越不易重复出现过至少一次的 Token（-2~2，每步0.1）')
            .min(-2).max(2).step(0.1).default(0.2),
        frequencyPenalty: Schema.number().description('频率惩罚，越高越不易重复出现次数较多的 Token（-2~2，每步0.1）')
            .min(-2).max(2).step(0.1).default(0.2),
    }).description('模型设置'),


])

export const using = ['chathub']

export const name = "chathub-openai-adapter"