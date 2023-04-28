import { Conversation, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import PoeAdapter from './index';
import { Context } from 'koishi';
import { Api } from './api';
import BardAdapter from './index';


const logger = createLogger('@dingyi222666/chathub-poe-adapter/client')

export class BardClient {

    private api: Api

   

    private isInit: boolean = false

    constructor(
        public config: BardAdapter.Config,
        public ctx: Context
    ) {
        this.api = new Api(config, ctx)
        
    }



    async ask(conversation: Conversation, message: SimpleMessage) {

        const prompt =  message.content

        let response = await this.api.request(prompt)

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