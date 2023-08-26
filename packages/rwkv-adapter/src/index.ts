import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'



const logger = createLogger()

export function apply(ctx: Context, config: Config) { }

export interface Config extends ChatHubPlugin.Config {
    apiKey: string
    apiEndPoint: string
    maxTokens: number
    chatModel: string
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,
    Schema.object({
        apiEndPoint: Schema.string().description('RWKV Runner 后端 API 地址').required(),
        apiKey: Schema.string().role('secret').description('RWKV 自搭建后端的身份验证 API Key').default("sk-"),


    }).description('请求设置'),

    Schema.object({
        maxTokens: Schema.number().description('回复的最大Token数（16~8192，必须是16的倍数）')
            .min(16).max(8192).step(16).default(256),
        chatModel: Schema.string().description('在 RWKV Runner 里设置的聊天模型名称').default('gpt-3.5-turbo')
    }).description('模型设置'),
])

export const using = ['chathub']

export const name = "@dingyi222666/chathub-rwkv-adapter"