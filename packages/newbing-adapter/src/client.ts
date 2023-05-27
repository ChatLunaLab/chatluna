
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { Api } from './api';

import { AIChatMessage, BaseChatMessage, SystemChatMessage } from "langchain/schema"
import { BingConversationStyle, ChatResponseMessage, ConversationInfo } from './types';
import BingChatPlugin from '.';
import { convertMessageToMarkdown } from './constants';


const logger = createLogger('@dingyi222666/chathub-newbing-adapter/client')


const errorMessageMatchTable = {
    "long context with 8k token limit, please start a new conversation": "上下文对话过长了呢，请重新开始对话",
    "The bing is end of the conversation. Try start a new conversation.": "Bing 已经结束了对话，继续回复将发起一个新的对话",
    "Connection closed with an error.": "连接被意外中止了呢",
    "No message was generated.": "Bing 已经结束了对话，继续回复将发起一个新的对话",
}

/**
 * https://github.com/waylaidwanderer/node-chatgpt-api/blob/main/src/BingAIClient.js
 */
export class BingChatClient {

    private _currentBingConversationInfo: ConversationInfo

    private _api: Api

    private _isThrottled = false

    constructor(
        public config: BingChatPlugin.Config,
    ) {
        this._api = new Api(config)
    }


    private _buildAdditionalReplyMessage(response: ChatResponseMessage): string {

        //猜你想问
        const stringBuilder = []
        const suggestedResponses = response.suggestedResponses

        if (suggestedResponses != null && suggestedResponses.length > 0) {
            stringBuilder.push("猜你想问：")
            for (let i = 0; i < suggestedResponses.length; i++) {
                const suggestedResponse = suggestedResponses[i];
                stringBuilder.push(" * " + suggestedResponse.text)
            }
        }
        //剩余回复数
        stringBuilder.push(`\n\n剩余回复数：${this._currentBingConversationInfo.invocationId} / ${this._currentBingConversationInfo.maxNumUserMessagesInConversation}`)

        return stringBuilder.join("\n")
    }

    async ask({
        message,
        sydney,
        previousMessages,
        style,
    }: {
        message: string,
        sydney: boolean,
        previousMessages: BaseChatMessage[],
        style: BingConversationStyle
    }): Promise<BaseChatMessage[]> {

        if (this._isThrottled == true) {
            sydney = false
        }

        if (this._currentBingConversationInfo == null || sydney) {
            const conversationResponse = await this._api.createConversation()
            this._currentBingConversationInfo = {
                conversationId: conversationResponse.conversationId,
                invocationId: 0,
                clientId: conversationResponse.clientId,
                conversationSignature: conversationResponse.conversationSignature,
                conversationStyle: style
            }
        }

        const result: BaseChatMessage[] = []

        const response = await this._api.sendMessage(this._currentBingConversationInfo, message, {
            sydney,
            previousMessages
        })



        if (response instanceof Error) {
            // TDOO: handle error
            // reset conversation
            this._currentBingConversationInfo = null

            const errorMessage = response.message

            if (errorMessage === "The account the SearchRequest was made with has been throttled.") {
                this._isThrottled = true
            }


            const errorMessageMatch = errorMessageMatchTable[errorMessage]

            if (errorMessageMatch != null) {
                result.push(new SystemChatMessage(errorMessageMatch))
                return result
            }

            const responseAsAny = response as any
            if (responseAsAny.cause != null) {
                logger.error(`NewBing Client Error: ${responseAsAny.message} cause: ${responseAsAny.cause}`)
            }

            throw new Error(errorMessageMatch)

        }

        logger.debug(`NewBing Client Response: ${JSON.stringify(response)}`)

        result.push(new AIChatMessage(convertMessageToMarkdown(response)))

        if (this.config.showExtraInfo === true) {
            result.push(new SystemChatMessage(this._buildAdditionalReplyMessage(response)))
        }

        return result

    }



    async clear() {
        this._currentBingConversationInfo = null
    }
}