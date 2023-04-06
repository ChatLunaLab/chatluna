import { Conversation, ConversationConfig, LLMChatAdapter, LLMChatService, Message, SimpleMessage } from '@dingyi222666/koishi-plugin-chathub';
import { Context, Logger, Schema } from 'koishi';
import { Api } from './api';
import { Prompt } from './prompt';

export const name = '@dingyi222666/chathub-openai-adapter'
export const using = ['llm-chat']


class OpenAIAdapter extends LLMChatAdapter<OpenAIAdapter.Config> {

    private conversationConfig: ConversationConfig

    private api: Api

    private prompt: Prompt

    private logger = new Logger('@dingyi222666/chathub-openai-adapter')

    private models: string[]

    constructor(public ctx: Context, public readonly config: OpenAIAdapter.Config) {
        super(ctx, config)
        this.api = new Api(config, ctx.http)
        this.prompt = new Prompt(config)
    }

    async init(config: ConversationConfig): Promise<void> {
        this.conversationConfig = config

        const models = this.models ?? await this.api.listModels()

        if (!models.includes(this.config.chatModel)) {
            throw new Error(`model ${this.config.chatModel} is not supported`)
        }

        if (models.length === 0) {
            throw new Error(`OpenAI API is not available, check your API key or network`)
        }


        if (this.models === undefined) {
            this.logger.info(`OpenAI API is available, current chat model is ${this.config.chatModel}`)
        }

        this.models = models

        return Promise.resolve()
    }

    ask(conversation: Conversation, message: Message): Promise<SimpleMessage> {
        if (this.config.chatModel.includes("turbo")) {
            return this.askTurbo(conversation, message)
        }
    }

    private async askTurbo(conversation: Conversation, message: Message): Promise<SimpleMessage> {
        const chatMessages = this.prompt.generatePrompt(conversation, message)

        const replyMessage = await this.api.chatTrubo(conversation, chatMessages)

        return {
            content: replyMessage.content,
            role: replyMessage.role == "assistant" ? "model" : replyMessage.role,
            sender: replyMessage.role == "assistant" ? "model" : replyMessage.role
        }
    }

}

namespace OpenAIAdapter {

    export interface Config extends LLMChatService.Config {
        apiKey: string
        apiEndPoint: string
        chatModel: string
        maxTokens: number
        temperature: number
        presencePenalty: number
        frequencyPenalty: number
    }

    export const Config: Schema<Config> = Schema.intersect([
        LLMChatService.createConfig({ label: 'openai' }),
        Schema.object({
            apiKey: Schema.string().role('secret').description('OpenAI 的 API Key').required(),
            apiEndPoint: Schema.string().description('请求OpenAI API的地址').default("https://api.openai.com/v1"),
            chatModel: Schema.union([
                'gpt-3.5-turbo',
                'gpt-3.5-turbo-0301',
                'text-davinci-003'
            ]).description('对话模型，如不懂请选择第一个').required(),
        }).description('请求设置'),

        Schema.object({
            maxTokens: Schema.number().description('回复的最大Token数（16~512，必须是16的倍数）')
                .min(16).max(512).step(16).default(256),
            temperature: Schema.percent().description('回复温度，越高越随机')
                .min(0).max(1).step(0.1).default(0.8),
            presencePenalty: Schema.number().description('重复惩罚，越高越不易重复出现过至少一次的Token（-2~2，每步0.1）')
                .min(-2).max(2).step(0.1).default(0.2),
            frequencyPenalty: Schema.number().description('频率惩罚，越高越不易重复出现次数较多的Token（-2~2，每步0.1）')
                .min(-2).max(2).step(0.1).default(0.2),
        }).description('模型设置'),


    ]) as Schema<Config>
}


export default OpenAIAdapter
