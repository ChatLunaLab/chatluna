import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { Context, Schema } from 'koishi'
import { LmsysProvider } from './providers'


const logger = createLogger('@dingyi222666/chathub-lmsys-adapter')

class LmsysPlugin extends ChatHubPlugin<LmsysPlugin.Config> {

    name = "@dingyi222666/chathub-lmsys-adapter"

    constructor(protected ctx: Context, public readonly config: LmsysPlugin.Config) {
        super(ctx, config)

        this.config.chatConcurrentMaxSize = 0

        setTimeout(async () => {
            await ctx.chathub.registerPlugin(this)

            this.registerModelProvider(new LmsysProvider(config))
        })

    }
}


namespace LmsysPlugin {

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends ChatHubPlugin.Config {
        formatMessages: boolean
    }

    export const Config: Schema<Config> = Schema.intersect([
        ChatHubPlugin.Config,


        Schema.object({
            formatMessages: Schema.boolean().description('是否使用历史聊天消息').default(true),
        }).description('对话设置'),
    ])



    export const using = ['chathub']

}



export default LmsysPlugin