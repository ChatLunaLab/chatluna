import { Dict, Logger, Quester } from 'koishi'
import OpenAIAdapter from "./index"
import { ChatMessage } from './types'
import { Conversation } from '@dingyi222666/koishi-plugin-chathub'

export class Api {

    private logger = new Logger('@dingyi222666/chathub-openai-adapter/api')

    constructor(
        private readonly config: OpenAIAdapter.Config,
        private readonly http: Quester
    ) { }

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

    private async get(url: string): Promise<Quester.AxiosResponse> {
        const reqeustUrl = this.concatUrl(url)

        return this.http.get(reqeustUrl, {
            headers: this.buildHeaders()
        })
    }

    private async post(urL: string, data: any): Promise<Quester.AxiosResponse> {
        const reqeustUrl = this.concatUrl(urL)

        return this.http.post(reqeustUrl, data, {
            headers: this.buildHeaders()
        })
    }


    async listModels(): Promise<string[]> {
        try {
            const response = await this.get("models")

            return (<Dict<string, any>[]>response.data).map((model) => model.id)
        } catch (e) {

            this.logger.error(
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
                model: this.config.chatModel,
                messages: messages,
                max_tokens: this.config.maxTokens,
                temperature: this.config.temperature,
                presence_penalty: this.config.presencePenalty,
                frequency_penalty: this.config.frequencyPenalty,
                user: conversation.sender, // set user as bot name
            })

            return response.data.choices[0] as ChatMessage
        } catch (e) {

            this.logger.error(
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