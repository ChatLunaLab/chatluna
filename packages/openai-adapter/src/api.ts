import { Dict } from 'koishi'
import OpenAIPlugin from "./index"
import { request } from '@dingyi222666/chathub-llm-core/lib/utils/request'
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger'
import { BaseChatMessage, MessageType } from 'langchain/schema'

const logger = createLogger('@dingyi222666/chathub-openai-adapter/api')

export class Api {

    constructor(
        private readonly config: OpenAIPlugin.Config
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

    private get(url: string) {
        const reqeustUrl = this.concatUrl(url)

        return request.fetch(reqeustUrl, {
            method: 'GET',
            headers: this.buildHeaders()
        })
    }

    private post(urL: string, data: any, params: Record<string, any> = {}) {
        const reqeustUrl = this.concatUrl(urL)

        return request.fetch(reqeustUrl, {
            body: JSON.stringify(data),
            headers: this.buildHeaders(),
            method: 'POST',
            ...params
        })
    }


    async listModels(): Promise<string[]> {
        try {
            const response = await this.get("models")
            const data = (<any>(await response.json()))

            logger.debug(`OpenAI API response: ${JSON.stringify(data)}`)

            logger.debug(JSON.stringify(data))

            return (<Dict<string, any>[]>(data.data)).map((model) => model.id)
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
        model: string,
        messages: BaseChatMessage[],
        signal?: AbortSignal
    ) {
        try {
            const response = await this.post("chat/completions", {
                model: model,
                messages: messages.map((message) => {
                    return {
                        role: messageTypeToOpenAIRole(message._getType()),
                        content: message.text
                    }
                }),
                max_tokens: this.config.maxTokens,
                temperature: this.config.temperature,
                presence_penalty: this.config.presencePenalty,
                frequency_penalty: this.config.frequencyPenalty,
                user: "user"
            }, {
                signal: signal
            })

            const data = (await response.json()) as {
                id: string;
                object: string;
                created: number;
                model: string;
                choices: Array<{
                    index: number;
                    finish_reason: string | null;
                    delta: { content?: string; role?: string };
                    message: { role: string, content: string }
                }>;
                usage: {
                    prompt_tokens: number,
                    completion_tokens: number,
                    total_tokens: number
                }
            };


            logger.debug(`OpenAI API response: ${JSON.stringify(data)}`)

            return data

        } catch (e) {

            logger.error(
                "Error when calling openai chat, Result: " + e.response
                    ? (e.response ? e.response.data : e)
                    : e
            );


            return null
        }
    }



}

export function messageTypeToOpenAIRole(
    type: MessageType
): string {
    switch (type) {
        case "system":
            return "system";
        case "ai":
            return "assistant";
        case "human":
            return "user";
        default:
            throw new Error(`Unknown message type: ${type}`);
    }
}