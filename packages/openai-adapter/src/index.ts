import { Conversation, ConversationConfig, LLMChatAdapter, LLMChatService, Message, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import { Context, Logger, Schema } from 'koishi';
import { Api } from './api';
import { Prompt } from './prompt';


const logger = createLogger('@dingyi222666/chathub-openai-adapter')


class OpenAIAdapter extends LLMChatAdapter<OpenAIAdapter.Config> {

    private conversationConfig: ConversationConfig

    public supportInject

    private api: Api

    private prompt: Prompt

    label: string

    private models: string[]

    constructor(ctx: Context, public config: OpenAIAdapter.Config) {
        super(ctx, config)
        logger.info(`OpenAI Adapter started`)
        this.api = new Api(config, ctx.http)
        this.supportInject = true
        this.prompt = new Prompt(config)
    }

    async init(config: ConversationConfig): Promise<void> {
        this.conversationConfig = config

        if (this.models !== undefined && this.models.includes(this.config.chatModel)) {
            return Promise.resolve()
        }

        const models = this.models ?? await this.api.listModels()


        if (!models.includes(this.config.chatModel)) {
            throw new Error(`model ${this.config.chatModel} is not supported`)
        }

        if (models.length === 0) {
            throw new Error(`OpenAI API is not available, check your API key or network`)
        }

        this.models = models

        if (this.models.includes(this.config.chatModel)) {
            logger.info(`OpenAI API is available, current chat model is ${this.config.chatModel}`)
        }

        return Promise.resolve()
    }

    async ask(conversation: Conversation, message: Message): Promise<Message> {
        const timeOut = setTimeout(() => {
            throw new Error('Timed out waiting for response. Try enabling debug mode to see more information.');
        }, this.config.timeout ?? 120 * 1000);

        const result = this.config.chatModel.includes("turbo") ?
            await this.askTurbo(conversation, message)
            : await this.askDavinci(conversation, message)

        clearTimeout(timeOut)

        if (result.content == "出现未知错误") {
            result.content = ""
            result.additionalReplyMessages = [
                {
                    content: "出现未知错误",
                    role: "system",
                    sender: "system"
                }
            ]
        }


        return result
    }

    private async askDavinci(conversation: Conversation, message: Message): Promise<Message> {
        const chatMessages = this.prompt.generatePromptForDavinci(conversation, message)

        const replyMessage = await this.api.chatDavinci(conversation, chatMessages)

        return {
            content: replyMessage.content,
            role: replyMessage.role == "assistant" ? "model" : replyMessage.role,
            sender: replyMessage.role == "assistant" ? "model" : replyMessage.role
        }
    }

    private async askTurbo(conversation: Conversation, message: Message): Promise<Message> {
        const chatMessages = this.prompt.generatePrompt(conversation, message)

        const replyMessage = await this.api.chatTrubo(conversation, chatMessages)

        return {
            content: replyMessage.content,
            role: replyMessage.role == "assistant" ? "model" : replyMessage.role,
            sender: replyMessage.role == "assistant" ? "model" : replyMessage.role
        }
    }

    async clear(): Promise<void> {

    }
}

namespace OpenAIAdapter {


    export const using = ['llmchat']

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
            ]).description('对话模型，如不懂请选择第一个').default('gpt-3.5-turbo'),
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


    ])
}

export const name = '@dingyi222666/chathub-openai-adapter'

export default OpenAIAdapter
