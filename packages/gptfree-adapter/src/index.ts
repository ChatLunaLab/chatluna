import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'



const logger = createLogger()

export function apply(ctx: Context, config: Config) {

}


export interface Config extends ChatHubPlugin.Config {
    apiEndPoint: string
}

export const Config: Schema<Config> = Schema.intersect([
    ChatHubPlugin.Config,
    Schema.object({
        apiEndPoint: Schema.string().description('请求 GPTFree 自搭建后端的API 地址').required(),

    }).description('请求设置'),
])

export const using = ['chathub']

export const name = "chathub-gptfree-adapter"
