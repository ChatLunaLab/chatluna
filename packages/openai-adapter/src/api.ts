import { Dict, Logger, Quester } from 'koishi'
import OpenAIAdapter from "./index"
import { ChatMessage } from './types'
import { Conversation, createLogger, request } from '@dingyi222666/koishi-plugin-chathub'
import { json } from 'stream/consumers'

const logger = createLogger('@dingyi222666/chathub-openai-adapter/api')

export class Api {


    constructor(
        private readonly config: OpenAIAdapter.Config,
        private readonly http: Quester
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
                model: this.config.chatModel,
                messages: messages,
                max_tokens: this.config.maxTokens,
                temperature: this.config.temperature,
                presence_penalty: this.config.presencePenalty,
                frequency_penalty: this.config.frequencyPenalty,
                user: conversation.sender
            })

            const data = (await response.json()) as any


            logger.debug(`OpenAI API response: ${JSON.stringify(data)}`)

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

            const data = (await response.json()) as any

            logger.debug(`OpenAI API raw response: ${JSON.stringify(data)}`)

            const choice = data.choices[0]

        
            let msg = choice.text + "}";

            // 直接解析
            try {
                const result = JSON.parse(msg);

                if (result.role && result.content && result.name) return result as ChatMessage
            } catch (e) {
            }

            // 尝试直接截取里面的content
            msg = msg.trim()
                .replace(/^[^{]*{/g, "{")
                .replace(/}[^}]*$/g, "}")
                .match(/"content":"(.*?)"/)?.[1] || msg.match(/"content": '(.*?)'/)?.[1] ||
                msg.match(/"content": "(.*?)/)?.[1] || msg.match(/"content":'(.*?)/)?.[1]

            if (msg) return {
                role: "assistant",
                content: msg,
                name: "assistant"
            }

            // 开摆返回text

            return {
                role: "assistant",
                content: choice.text,
                name: "assistant"
            }
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