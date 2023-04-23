import { Conversation, ConversationConfig, LLMChatAdapter, LLMChatService, Message, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import { Context, Logger, Schema } from 'koishi';
import { PoeClient } from './client';
import { readFileSync } from 'fs';


const logger = createLogger('@dingyi222666/chathub-poe-adapter')


class PoeAdapter extends LLMChatAdapter<PoeAdapter.Config> {

    public supportInject: boolean

    private client: PoeClient

    label: string

    constructor(ctx: Context, public config: PoeAdapter.Config) {
        super(ctx, config)
        logger.info(`Poe Adapter started`)

        this.supportInject = true
        // 只支持同时一个请求喵
        config.conversationChatConcurrentMaxSize = 1
        this.client = new PoeClient(config, ctx)
    }

    async init(conversation: Conversation, config: ConversationConfig): Promise<void> {
        if (this.config.acceptSystemPrompt && this.config.injectPrompt) {
            await this.client.init(conversation)
        }

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
            // print stack
            if (e.cause) {
                logger.error(e.cause)
            }

            throw e
        }
    }

    async clear() {
        await this.client.reset()
    }

}

namespace PoeAdapter {


    export const using = ['llmchat']

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends LLMChatService.Config {
        pbcookie: string,
        model: string,
        injectPrompt: boolean,
        acceptSystemPrompt: boolean,
    }

    export const Config: Schema<Config> = Schema.intersect([
        LLMChatService.createConfig({ label: 'poe' }),

        Schema.object({
            pbcookie: Schema.string().description('Poe账号的cookie的p-b 的值').default("").required()
        }).description('请求设置'),

        Schema.object({
            model: Schema.union(
                [
                    Schema.const("ChatGPT").description("ChatGPT"),
                    Schema.const("Dragonfly").description("Dragonfly"),
                    Schema.const("GPT-4").description("GPT-4"),
                    Schema.const("Claude-instant").description("Claude"),
                    Schema.const("Claude+").description("Claude+"),
                    Schema.const("NeevaAI").description("NeevaAI"),
                    Schema.const("Sage").description("Sage"),
                ]
            ).description('对话模型').default("Sage"),
        }).description('模型设置'),

        Schema.object({
            injectPrompt: Schema.boolean().description('是否支持注入Prompt（并且会尝试优化对话Prompt）').default(false),
            acceptSystemPrompt: Schema.boolean().description('是否接受System Prompt(需要打开注入Prompt)').default(false),
        }).description('对话设置'),
    ])
}

export const name = '@dingyi222666/chathub-poe-adapter'

export default PoeAdapter
