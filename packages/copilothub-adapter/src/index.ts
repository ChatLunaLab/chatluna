import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'
import { CopilotHubProvider } from './provider'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'


const logger = createLogger('@dingyi222666/chathub-copilothub-adapter')

class CopilotHubPlugin extends ChatHubPlugin<CopilotHubPlugin.Config> {

    name = "@dingyi222666/chathub-copilothub-adapter"

    constructor(protected ctx: Context, public readonly config: CopilotHubPlugin.Config) {
        super(ctx, config)
        this.config.chatConcurrentMaxSize = 0

        setTimeout(async () => {
            await ctx.chathub.registerPlugin(this)

            this.registerModelProvider(new CopilotHubProvider(config))
        })

    }
}


namespace CopilotHubPlugin {

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends ChatHubPlugin.Config {
        apiKey: string,
        formatMessage: boolean
    }

    export const Config: Schema<Config> = Schema.intersect([
        ChatHubPlugin.Config,

        Schema.object({
            apiKey: Schema.string().description('Copilot Hub Bot 的 API KEY').default("").required()

        }).description('请求设置'),

        Schema.object({
            formatMessage: Schema.boolean().description('是否使用历史聊天消息').default(false),
        }).description('对话设置'),

    ])



    export const using = ['chathub']

}



export default CopilotHubPlugin