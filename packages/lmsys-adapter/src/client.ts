
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger';
import { Api } from './api';

import { AIChatMessage, BaseChatMessage, SystemChatMessage } from "langchain/schema"

import LmsysPlugin from '.';
import { generateSessionHash } from './utils';



const logger = createLogger('@dingyi222666/chathub-lmsys-adapter/client')



/**
 * https://github.com/waylaidwanderer/node-chatgpt-api/blob/main/src/BingAIClient.js
 */
export class LmsysClient {

    private _currentConversationHash: string

    private _api: Api


    constructor(
        _modelName: string,
    ) {
        this._api = new Api(_modelName)
    }


    async ask({
        message,
        previousMessages,
    }: {
        message: string,
        previousMessages: BaseChatMessage[],
    }): Promise<BaseChatMessage> {

        if (this._currentConversationHash == null) {
            this._currentConversationHash = generateSessionHash()
        }

        const response = await this._api.sendMessage(this._currentConversationHash, message, previousMessages)


        if (response instanceof Error) {
            // TDOO: handle error
            // reset conversation
            this._currentConversationHash = null


            const responseAsAny = response as any
            if (responseAsAny.cause != null) {
                logger.error(`lmsys Client Error: ${responseAsAny.message} cause: ${responseAsAny.cause}`)
            }

            throw response

        }

        logger.debug(`lmsys Client Response: ${JSON.stringify(response)}`)

        return new AIChatMessage(response)



    }



    async clear() {
        this._currentConversationHash = null
    }
}