import { Conversation, ConversationConfig, LLMChatAdapter, LLMChatService, Message, SimpleMessage } from '@dingyi222666/koishi-plugin-chathub';
import { Context, Schema } from 'koishi';

export const name = '@dingyi222666/chathub-openai-adapter'
export const using = ['llm-chat']


class OpenAIAdapter extends LLMChatAdapter<OpenAIAdapter.Config> {

    constructor(public ctx: Context, public config: OpenAIAdapter.Config) {
        super(ctx, config)
    }

    init(config: ConversationConfig): Promise<void> {
        throw new Error('Method not implemented.');
    }
    ask(conversation: Conversation, message: SimpleMessage): Promise<Message> {
        throw new Error('Method not implemented.');
    }

}

namespace OpenAIAdapter {

    export interface Config extends LLMChatService.Config {
        apiKey: string
        apiAdress: string
        chatModel: string
        nTokens: number
        temperature: number
        presencePenalty: number
        frequencyPenalty: number
    }

    export const Config: Schema<Config> = Schema.intersect([
        LLMChatService.createConfig({ label: 'openai' }),
        Schema.object({
            apiKey: Schema.string().role('secret').description('OpenAI 的 API Key').required(),
            apiAdress: Schema.string().description('请求OpenAI API的地址').default("https://api.openai.com/v1"),
            chatModel: Schema.union([
                'gpt-3.5-turbo',
                'gpt-3.5-turbo-0301',
                'text-davinci-003'
            ]).description('对话模型，如不懂请选择第一个').required(),
        }).description('请求设置'),

        /*    Schema.object({
               nTokens: Schema.number().description('回复的最大Token数（16~512，必须是16的倍数）')
                   .min(16).max(512).step(16).default(256),
               temperature: Schema.percent().description('回复温度，越高越随机')
                   .min(0).max(1).step(0.1).default(0.8),
               presencePenalty: Schema.number().description('重复惩罚，越高越不易重复出现过至少一次的Token（-2~2，每步0.1）')
                   .min(-2).max(2).step(0.1).default(0.2),
               frequencyPenalty: Schema.number().description('频率惩罚，越高越不易重复出现次数较多的Token（-2~2，每步0.1）')
                   .min(-2).max(2).step(0.1).default(0.2),
           }).description('模型设置'),
    */
        Schema.union([
            Schema.object({
                chatModel: Schema.const(
                    'gpt-3.5-turbo').required(),
                nTokens: Schema.number().description('回复的最大Token数（16~512，必须是16的倍数）')
                    .min(16).max(512).step(16).default(256),
                temperature: Schema.percent().description('回复温度，越高越随机')
                    .min(0).max(1).step(0.1).default(0.8),
                presencePenalty: Schema.number().description('重复惩罚，越高越不易重复出现过至少一次的Token（-2~2，每步0.1）')
                    .min(-2).max(2).step(0.1).default(0.2),
                frequencyPenalty: Schema.number().description('频率惩罚，越高越不易重复出现次数较多的Token（-2~2，每步0.1）')
                    .min(-2).max(2).step(0.1).default(0.2),
            }).description('模型设置'),
            Schema.object({
                chatModel: Schema.const(
                    'gpt-3.5-turbo-0301').required(),
                nTokens: Schema.number().description('回复的最大Token数（16~512，必须是16的倍数）')
                    .min(16).max(512).step(16).default(256),
                temperature: Schema.percent().description('回复温度，越高越随机')
                    .min(0).max(1).step(0.1).default(0.8),
                presencePenalty: Schema.number().description('重复惩罚，越高越不易重复出现过至少一次的Token（-2~2，每步0.1）')
                    .min(-2).max(2).step(0.1).default(0.2),
                frequencyPenalty: Schema.number().description('频率惩罚，越高越不易重复出现次数较多的Token（-2~2，每步0.1）')
                    .min(-2).max(2).step(0.1).default(0.2),
            }).description('模型设置'),
            Schema.object({
                chatModel: Schema.const(
                    'text-davinci-003').required(),
                nTokens: Schema.number().description('回复的最大Token数（16~512，必须是16的倍数）')
                    .min(16).max(512).step(16).default(256),
            }).description('模型设置'),
        ]).required(),

    ]) as Schema<Config>
}


export default OpenAIAdapter
