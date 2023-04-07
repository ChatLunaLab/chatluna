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

    private async get(url: string): Promise<any> {
        const reqeustUrl = this.concatUrl(url)

        return this.http.get(reqeustUrl, {
            headers: this.buildHeaders()
        })
    }

    private async post(urL: string, data: any): Promise<any> {
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
                user: conversation.sender
            })


            this.logger.info(`OpenAI API response: ${JSON.stringify(response)}`)

            return <ChatMessage>response.choices[0].message

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


    // thanks https://github.com/TomLBZ/koishi-plugin-openai/blob/52464886db4c8abc8f15a108d8b7aad589db3b6e/src/ai.ts#L217
    async chatDavinci(
        conversation: Conversation,
        prompt: string
    ): Promise<ChatMessage> {
        try {
            const response = await this.post("completions", {
                model: this.config.chatModel,
                prompt: prompt,
                max_tokens: this.config.maxTokens,
                temperature: this.config.temperature,
                presence_penalty: this.config.presencePenalty,
                frequency_penalty: this.config.frequencyPenalty,
                // 使用 } 作为对话结束的标志
                stop: "}",
                user: conversation.sender,
            })

            const choice = response.choices[0]
            let msg = choice.text + "}";

            // 第一次：直接解析
            try {
                const result = JSON.parse(msg);

                if (result.role && result.content && result.name) return result as ChatMessage
            } catch (e) {
            }

            // 第二次：尝试直接截取里面的content

            msg = msg.trim()
            .replace(/^[^{]*{/g, "{")
            .replace(/}[^}]*$/g, "}")

            .match(/"content":"(.*?)"/)?.[1] || msg.match(/"content": '(.*?)'/)?.[1]

            if (msg) return {
                role: "assistant",
                content: msg,
                name: "assistant"
            }

            throw new Error("解析出错")
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