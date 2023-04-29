import { Conversation, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import { Context } from 'koishi';
import { Api } from './api';
import BardAdapter from './index';


const logger = createLogger('@dingyi222666/chathub-bard-adapter/client')

export class BardClient {

    private api: Api

    constructor(
        public config: BardAdapter.Config,
        public ctx: Context
    ) {
        this.api = new Api(config, ctx)
    }

    async ask(conversation: Conversation, message: SimpleMessage) {

        const messageTimeout = setTimeout(async () => {
            throw new Error('Timed out waiting for response. Try enabling debug mode to see more information.');
        }, this.config.timeout ?? 120 * 1000);

        const prompt = message.content

        let response = await this.api.request(prompt)

        clearTimeout(messageTimeout)

        if (response instanceof Error) {
            logger.error(`request error: ${response.message}`)
            return Promise.reject(response)
        }

        return response
    }

    async reset() {
        const successful = await this.api.clearConversation()

        return successful
    }

}