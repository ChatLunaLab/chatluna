import { Conversation, ConversationConfig, LLMChatAdapter, LLMChatService, Message, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import { Context, Schema } from 'koishi';
import { BardClient } from './client';



const logger = createLogger('@dingyi222666/chathub-poe-adapter')


class BardAdapter extends LLMChatAdapter<BardAdapter.Config> {

    public supportInject: boolean

    private client: BardClient

    label: string

    constructor(ctx: Context, public config: BardAdapter.Config) {
        super(ctx, config)
        logger.debug(`Bard Adapter started`)

        this.supportInject = false
        this.description = "Google Bard的适配器"
        // 只支持同时一个请求喵
        config.conversationChatConcurrentMaxSize = 0
        this.client = new BardClient(config, ctx)
       
    }

    async init(conversation: Conversation, config: ConversationConfig): Promise<void> {
        
        //TODO: check cookie and apiEndPoint
        return Promise.resolve()
    }

    async ask(conversation: Conversation, message: Message): Promise<Message> {
        try {
            const response = await this.client.ask(conversation, message)

            return {
                content: response,
                role: "model",
                sender: "model",
            }
        } catch (e) {

            throw e
        }
    }

    async clear() {
        await this.client.reset()
    }

}

namespace BardAdapter {

    export const using = ['llmchat']

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends LLMChatService.Config {
        cookie: string,
    }

    export const Config: Schema<Config> = Schema.intersect([
        LLMChatService.createConfig({ label: 'bard' }),

        Schema.object({
            cookie: Schema.string().description('在 bard.google.com 登录后获取的Cookie').required()
        }).description('请求设置'),


    ])
}

export const name = '@dingyi222666/chathub-bard-adapter'

export default BardAdapter
