import { Dict, Logger, Quester } from 'koishi'
import OpenAIAdapter from "./index"
import { ChatMessage } from './types'
import { Conversation, createLogger, request } from '@dingyi222666/koishi-plugin-chathub'
import ChatGLMAdapter from './index'


const logger = createLogger('@dingyi222666/chathub-chatglm-adapter/api')

export class Api {


    constructor(
        private readonly config: ChatGLMAdapter.Config,
    ) {

    }

    private buildHeaders() {
        return {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json"
        }
    }

    private concatUrl(url: string): string {
        const apiEndPoint = this.config.apiEndPoint

        if (apiEndPoint.endsWith('/')) {
            return apiEndPoint + url
        }

        return apiEndPoint + '/' + url
    }

    private get(url: string) {
        const reqeustUrl = this.concatUrl(url)

        return request.fetch(reqeustUrl, {
            method: 'GET',
            headers: this.buildHeaders()
        })
    }

    private post(urL: string, data: any) {
        const reqeustUrl = this.concatUrl(urL)

        return request.fetch(reqeustUrl, {
            body: JSON.stringify(data),
            headers: this.buildHeaders(),
            method: 'POST'
        })
    }


    async listModels(): Promise<string[]> {
        try {
            const response = await this.get("models")
            const data = (<any>(await response.json())).data
            
            return (<Dict<string, any>[]>data).map((model) => model.id)
        } catch (e) {

            logger.error(
                "Error when listing openai models, Result: " + e.response
                    ? (e.response ? e.response.data : e)
                    : e
            );

            // return fake empty models
            return []
        }
    }


    async chatTrubo(
        conversation: Conversation,
        messages: ChatMessage[]
    ): Promise<ChatMessage> {
        try {
            const response = await this.post("chat/completions", {
                model: "gpt-3.5-turbo",
                messages: messages,
                max_tokens: this.config.maxTokens,
                temperature: this.config.temperature,
                user: conversation.sender
            })

            const data = (await response.json()) as any


            logger.debug(`ChatGLM API response: ${JSON.stringify(data)}`)

            return data.choices[0].message

        } catch (e) {

            logger.error(
                "Error when calling openai chat, Result: " + e.response
                    ? (e.response ? e.response.data : e)
                    : e
            );

            // return fake empty models
            return {
                role: "system",
                content: "出现未知错误",
                name: "system"
            }
        }
    }



}