import { Conversation, ConversationConfig, LLMChatAdapter, LLMChatService, Message, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import { Context, Logger, Schema } from 'koishi';
import { CopilotHubClient } from './client';



const logger = createLogger('@dingyi222666/chathub-copilothub-adapter')

class CopilotHubAdapter extends LLMChatAdapter<CopilotHubAdapter.Config> {

    public supportInject: boolean

    private client: CopilotHubClient

    label: string

    constructor(ctx: Context, public config: CopilotHubAdapter.Config) {
        super(ctx, config)
        logger.debug(`CopilotHub Adapter started`)

        this.supportInject = true
        this.description = "CopilotHub 的适配器"
        // 只支持同时一个请求喵
        config.conversationChatConcurrentMaxSize = 0
        this.client = new CopilotHubClient(config, ctx)
      
    }

    async init(conversation: Conversation, config: ConversationConfig): Promise<void> {
        //TODO: check api key
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
        //TODO: clear context???
    }

}

namespace CopilotHubAdapter {

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends LLMChatService.Config {
        apiKey: string,

        injectPrompt: boolean,

    }

    export const Config: Schema<Config> = Schema.intersect([
        LLMChatService.createConfig({ label: 'copilothub' }),

        Schema.object({
            apiKey: Schema.string().description('Copilot Hub Bot 的 API KEY').default("").required()
        }).description('请求设置'),


        Schema.object({
            injectPrompt: Schema.boolean().description('是否支持注入Prompt（并且会尝试优化对话Prompt）').default(false),
        }).description('对话设置'),
    ])


    export const using = ['llmchat']
}



export default CopilotHubAdapter
