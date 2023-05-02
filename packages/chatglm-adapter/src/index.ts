import { Conversation, ConversationConfig, LLMChatAdapter, LLMChatService, Message, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import { Context, Logger, Schema } from 'koishi';
import { Api } from './api';
import { Prompt } from './prompt';


const logger = createLogger('@dingyi222666/chathub-chatglm-adapter')


class ChatGLMAdapter extends LLMChatAdapter<ChatGLMAdapter.Config> {

    public supportInject: boolean

    private api: Api

    private prompt: Prompt

    label: string

    private models: string[]

    private chatModel = "gpt-3.5-turbo"

    constructor(ctx: Context, public config: ChatGLMAdapter.Config) {
        super(ctx, config)
        logger.debug(`ChatGLM Adapter started`)
        this.description = "ChatGLM 的适配器，需要搭建后端"
        this.api = new Api(config)
        this.supportInject = true
        this.prompt = new Prompt(config)
    }

    async init(conversation: Conversation, config: ConversationConfig): Promise<void> {
        if (this.models != null && this.models.includes(this.chatModel)) {
            return Promise.resolve()
        }

        const models = this.models ?? await this.api.listModels()

        if (!models.includes(this.chatModel)) {
            throw new Error(`model ${this.chatModel} is not supported`)
        }

        if (models.length === 0) {
            throw new Error(`CharGLM Server is not available, check your token or network or server`)
        }

        this.models = models

        if (this.models.includes(this.chatModel)) {
            //ChatGLM 服务端可用
            logger.debug(`ChatGLM server is available`)
        }

        return Promise.resolve()
    }

    async ask(conversation: Conversation, message: Message): Promise<Message> {
        const timeOut = setTimeout(() => {
            throw new Error('Timed out waiting for response. Try enabling debug mode to see more information.');
        }, this.config.timeout ?? 120 * 1000);

        const result = await this.askTurbo(conversation, message)

        clearTimeout(timeOut)

        if (result.content === "出现未知错误") {
            result.content = ""
            result.additionalReplyMessages = [
                {
                    content: "出现了未知错误呢",
                    role: "system",
                    sender: "system"
                }
            ]
        }


        return result
    }

    private async askTurbo(conversation: Conversation, message: Message): Promise<Message> {
        const chatMessages = this.prompt.generatePrompt(conversation, message)

        const replyMessage = await this.api.chatTrubo(conversation, chatMessages)

        return {
            content: replyMessage.content,
            role: replyMessage.role === "assistant" ? "model" : replyMessage.role,
            sender: replyMessage.role === "assistant" ? "model" : replyMessage.role
        }
    }

    async dispose(): Promise<void> {
        this.prompt.dispose()
    }
}

namespace ChatGLMAdapter {

    //export const usage = readFileSync(__dirname + '/../README.md', 'utf8')

    export interface Config extends LLMChatService.Config {
        apiKey: string
        apiEndPoint: string

        maxTokens: number
        temperature: number
    }

    export const Config: Schema<Config> = Schema.intersect([
        LLMChatService.createConfig({ label: 'glm' }),
        Schema.object({
            apiKey: Schema.string().role('secret').description('ChatGLM 自搭建后端的可访问的token').required(),
            apiEndPoint: Schema.string().description('请求ChatGLM 自搭建后端的API地址').required(),

        }).description('请求设置'),

        Schema.object({
            maxTokens: Schema.number().description('回复的最大Token数（16~512，必须是16的倍数）')
                .min(16).max(512).step(16).default(256),
            temperature: Schema.percent().description('回复温度，越高越随机')
                .min(0).max(1).step(0.1).default(0.8),

        }).description('模型设置'),
    ])


   
    export const using = ['llmchat']

}


export default ChatGLMAdapter
