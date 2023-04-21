import { Conversation, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import PoeAdapter from './index';
import { Context } from 'koishi';
import { Api } from './api';
import { Prompt } from './prompt';
import { PoeMessage } from './types';

const logger = createLogger('@dingyi222666/chathub-poe-adapter/client')

export class PoeClient {

    private api: Api

    private prompt: Prompt

    constructor(
        public config: PoeAdapter.Config,
        public ctx: Context
    ) {
        this.api = new Api(config, ctx)
        this.prompt = new Prompt(config)
    }

    async init(conversation: Conversation) {
        const response = await this.ask(conversation, {
            role: 'system',
            content: this.prompt.generateSystemPrompt(conversation),
            sender: 'system'
        }, false)


        logger.debug(`init response: ${JSON.stringify(response)}`)

        return Promise.resolve()
    }


    async ask(conversation: Conversation, message: SimpleMessage,
        formatPrompt: boolean = this.config.injectPrompt) {

        const prompt = formatPrompt ? this.prompt.generateUserPrompt(conversation, message) : message.content

        let response = await this.api.request(prompt)

        if (response instanceof Error) {
            logger.error(`request error: ${response.message}`)
            return Promise.reject(response)
        }

        if (formatPrompt) {
            try {
                const decodeContent = JSON.parse(response) as PoeMessage

                // check decodeContent fields is PoeMessage

                if (decodeContent.content && decodeContent.name && decodeContent.role) {
                    return decodeContent.content
                }
            } catch (e) {
                logger.error(`decode error: ${e.message}`)
            }

            const matchContent = response.trim()
                .replace(/^[^{]*{/g, "{")
                .replace(/}[^}]*$/g, "}")
                .match(/"content":"(.*?)"/)?.[1] || response.match(/"content": '(.*?)'/)?.[1] ||
                response.match(/"content": "(.*?)/)?.[1] || response.match(/"content":'(.*?)/)?.[1]

            if (matchContent) {
                return matchContent
            }
        }

        return response
    }

    async reset() {
        const successful = await this.api.clearContext()
        this.api.closeConnect()

        return successful
    }

}