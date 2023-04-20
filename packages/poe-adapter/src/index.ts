import { Conversation, ConversationConfig, LLMChatAdapter, LLMChatService, Message, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import { Context, Logger, Schema } from 'koishi';



const logger = createLogger('@dingyi222666/chathub-poe-adapter')


class PoeAdapter extends LLMChatAdapter<PoeAdapter.Config> {

    private conversationConfig: ConversationConfig

    public supportInject: boolean

    label: string

    constructor(ctx: Context, public config: PoeAdapter.Config) {
        super(ctx, config)
        logger.info(`Poe Adapter started`)

        this.supportInject = false
    }

    async init(config: ConversationConfig): Promise<void> {
        this.conversationConfig = config

        //TODO: check cookie and apiEndPoint
        return Promise.resolve()
    }

    async ask(conversation: Conversation, message: Message): Promise<Message> {
       throw new Error("not implemented")
    }

    async clear() {

    }

}

namespace PoeAdapter {


    export const using = ['llmchat']

    export interface Config extends LLMChatService.Config {
        cookie: string,
        model: string
    }

    export const Config: Schema<Config> = Schema.intersect([
        LLMChatService.createConfig({ label: 'poe' }),

        Schema.object({
            cookie: Schema.string().description('Poe账号的cookie').default("").required()
        }).description('请求设置'),

        Schema.object({
            model: Schema.union(
                [
                    Schema.const("nutria").description("ChatGPT"),
                    Schema.const("dragonfly").description("Dragonfly"),
                    Schema.const("beaver").description("GPT-4"),
                    Schema.const("a2").description("Claude"),
                    Schema.const("a2_2").description("Claude+"),
                    Schema.const("hutia").description("NeevaAI"),
                    Schema.const("capybara").description("Sage"),
                ]
            ).description('对话模型').default("nutria"),
        }).description('模型设置'),

       /*  Schema.object({

        }).description('对话设置'), */

    ])
}

export const name = '@dingyi222666/chathub-poe-adapter'

export default PoeAdapter
