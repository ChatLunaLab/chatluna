import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'
import { Claude2ChatProvider } from './providers'


const logger = createLogger('@dingyi222666/chathub-claude2-adapter')

class Claude2ChatPlugin extends ChatHubPlugin<Claude2ChatPlugin.Config> {

    name = "@dingyi222666/chathub-claude2-adapter"

    constructor(protected ctx: Context, public readonly config: Claude2ChatPlugin.Config) {
        super(ctx, config)

        this.config.chatConcurrentMaxSize = 0

        setTimeout(async () => {
            await ctx.chathub.registerPlugin(this)

            this.registerModelProvider(new Claude2ChatProvider(config))
        })

    }
}


namespace Claude2ChatPlugin {

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends ChatHubPlugin.Config {
        cookie: string,

        formatMessages: boolean
    }

    export const Config: Schema<Config> = Schema.intersect([
        ChatHubPlugin.Config,

        Schema.object({
            cookie: Schema.string().role('secret').description('Claude 账号的 Cookie').default("")
        }).description('请求设置'),

        Schema.object({
            formatMessages: Schema.boolean().description('是否使用历史聊天消息').default(false),
        }).description('对话设置'),


    ])



    export const using = ['chathub']

}



export default Claude2ChatPlugin