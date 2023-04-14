import { Conversation, ConversationConfig, LLMChatAdapter, LLMChatService, Message, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import { Context, Logger, Schema } from 'koishi';
import { NewBingClient } from './client';



const logger = createLogger('@dingyi222666/chathub-newbing-adapter')


class NewBingAdapter extends LLMChatAdapter<NewBingAdapter.Config> {

    private conversationConfig: ConversationConfig

    public supportInject

    label: string

    private client: NewBingClient


    constructor(ctx: Context, public config: NewBingAdapter.Config) {
        super(ctx, config)
        logger.info(`NewBing Adapter started`)

        this.supportInject = false

        this.client = new NewBingClient(config, ctx)
    }

    async init(config: ConversationConfig): Promise<void> {
        this.conversationConfig = config

        //TODO: check cookie and apiEndPoint
        return Promise.resolve()
    }

    async ask(conversation: Conversation, message: Message): Promise<SimpleMessage> {
        return this.client.ask(conversation, message)
    }


}

namespace NewBingAdapter {


    export const using = ['llmchat']

    export interface Config extends LLMChatService.Config {
        cookie: string,
        bingHost: string,
        bingWebSocketHost: string
    }

    export const Config: Schema<Config> = Schema.intersect([
        LLMChatService.createConfig({ label: 'newbing' }),

        Schema.object({
            cookie: Schema.string().description('Bing账号的cookie').default(""),
            bingHost: Schema.string().description('请求 Bing 的 API host'),
            bingWebSocketHost: Schema.string().description('请求 Bing 的WebSocket host'),
        }).description('请求设置'),


    ])
}

export const name = '@dingyi222666/chathub-newbing-adapter'

export default NewBingAdapter