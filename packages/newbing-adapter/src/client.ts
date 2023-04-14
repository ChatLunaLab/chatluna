import { Message, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import NewBingAdapter from './index';
import { Context } from 'koishi';
import { ApiRequest, ApiResponse, BingConversation, ClientRequest, ToneStyle } from './types';
import { Api } from './api';
import { Prompt } from './prompt';


const logger = createLogger('@dingyi222666/chathub-newbing-adapter/client')


const errorMessageMatchTable = {
    "long context with 8k token limit, please start a new conversation": "上下文对话过长了呢，请重新开始对话",
    "The bing is end of the conversation. Try start a new conversation.": "Bing已经结束了对话，继续回复将发起一个新的对话",
    "Connection closed with an error.": "连接被意外中止了呢",
    "No message was generated.": "Bing已经结束了对话，继续回复将发起一个新的对话",
}

/**
 * https://github.com/waylaidwanderer/node-chatgpt-api/blob/main/src/BingAIClient.js
 */
export class NewBingClient {

    private currentBingConversation: BingConversation = {
        invocationId: 0
    }

    private api: Api

    private prompt = new Prompt();

    constructor(
        public config: NewBingAdapter.Config,
        public ctx: Context
    ) {
        this.api = new Api(config, ctx)
    }




    private buildAdditionalReplyMessages(apiResponse: ApiResponse | Error): SimpleMessage[] {

        const result: SimpleMessage[] = []
        if (apiResponse instanceof Error) {
            const errorMessage = apiResponse.message

            const errorMessageMatch = errorMessageMatchTable[errorMessage] ?? "出现了未知错误呢"

            result.push({
                content: errorMessageMatch,
                sender: "system",
                role: "system"
            })
        } else {

            //猜你想问
            const stringBuilder = []
            const suggestedResponses = apiResponse.message.suggestedResponses

            if (suggestedResponses != null && suggestedResponses.length > 0) {
                stringBuilder.push("猜你想问：")
                for (let i = 0; i < suggestedResponses.length; i++) {
                    const suggestedResponse = suggestedResponses[i];
                    stringBuilder.push(" * " + suggestedResponse.text)
                }
            }

            //剩余回复数
            stringBuilder.push(`\n\n剩余回复数：${apiResponse.conversation.invocationId} / ${apiResponse.respose.item.throttling.maxNumUserMessagesInConversation}`)

            result.push({
                content: stringBuilder.join("\n"),
                sender: "system",
                role: "system"
            })

        }
        return result
    }

    async ask(request: ClientRequest): Promise<Message> {

        let apiResponse: ApiResponse | Error

        try {
            apiResponse = await this.api.request({
                bingConversation: this.currentBingConversation,
                toneStyle: this.config.toneStyle as ToneStyle,
                sydney: this.config.sydney,
                prompt: this.config.sydney ? this.prompt.generatePrompt(request.conversation, request.message) : request.message.content
            })
        } catch (error) {
            apiResponse = error
        }

        if (apiResponse instanceof Error) {
            //TDOO: handle error
            // reset conversation
            this.currentBingConversation = { invocationId: 0 }

            const result: Message = {
                content: "",
                sender: "system",
                role: "model"
            }

            result.additionalReplyMessages = this.buildAdditionalReplyMessages(apiResponse)

            return result
        }

        this.currentBingConversation = apiResponse.conversation

        logger.debug(`NewBing Client Response: ${JSON.stringify(apiResponse.message)}`)

        const result: Message = {
            content: apiResponse.message.text,
            sender: "model",
            role: 'model'
        }

        if (this.config.showExtraInfo == true) {
            result.additionalReplyMessages = this.buildAdditionalReplyMessages(apiResponse)
        }

        return result

    }

    reset() {
        if (this.api) {
            this.api.reset();
        }
    }
}