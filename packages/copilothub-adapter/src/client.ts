import { Conversation, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub';
import CopilotHubAdapter from './index';
import { Context } from 'koishi';
import { Api } from './api';
import { Prompt } from './prompt';
import { CopilotMessage } from './types';

const logger = createLogger('@dingyi222666/chathub-copilothub-adapter/client')

export class CopilotHubClient {

    private api: Api

    private prompt: Prompt

    private isInit: boolean = false

    constructor(
        protected config: CopilotHubAdapter.Config,
        protected ctx: Context
    ) {
        this.api = new Api(config)
        this.prompt = new Prompt(config)
    }

    async ask(conversation: Conversation, message: SimpleMessage,
        formatPrompt: boolean = this.config.injectPrompt) {

        const prompt = formatPrompt ? this.prompt.generatePromptForChat(conversation, message) : message.content

        let response = await this.api.request(prompt)

        if (response instanceof Error) {
            logger.error(`request error: ${response.message}`)
            return Promise.reject(response)
        }

        if (formatPrompt) {
            try {
                const decodeContent = JSON.parse(response) as CopilotMessage

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



}