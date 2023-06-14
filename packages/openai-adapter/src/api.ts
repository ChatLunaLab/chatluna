import { Dict } from 'koishi'
import OpenAIPlugin from "./index"
import { request } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { BaseChatMessage, FunctionChatMessage, MessageType } from 'langchain/schema'

const logger = createLogger('@dingyi222666/chathub-openai-adapter/api')

export class Api {

    constructor(
        private readonly config: OpenAIPlugin.Config
    ) { }

    private _buildHeaders() {
        return {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json"
        }
    }

    private _concatUrl(url: string): string {
        const apiEndPoint = this.config.apiEndPoint

        if (apiEndPoint.endsWith('/')) {
            return apiEndPoint + url
        }

        return apiEndPoint + '/' + url
    }

    private _get(url: string) {
        const reqeustUrl = this._concatUrl(url)

        return request.fetch(reqeustUrl, {
            method: 'GET',
            headers: this._buildHeaders()
        })
    }

    private _post(url: string, data: any, params: Record<string, any> = {}) {
        const reqeustUrl = this._concatUrl(url)

        return request.fetch(reqeustUrl, {
            body: JSON.stringify(data),
            headers: this._buildHeaders(),
            method: 'POST',
            ...params
        })
    }


    async listModels(): Promise<string[] | null> {
        try {
            const response = await this._get("models")
            const data = (<any>(await response.json()))

            logger.debug(JSON.stringify(data))

            return (<Dict<string, any>[]>(data.data)).map((model) => model.id)
        } catch (e) {

            logger.error(
                "Error when listing openai models, Result: " + e.response
                    ? (e.response ? e.response.data : e)
                    : e
            );

            // return fake empty models
            return null
        }
    }


    async chatTrubo(
        model: string,
        messages: BaseChatMessage[],
        signal?: AbortSignal
    ) {
        let data: ChatCompletionResponse | any
        try {
            const response = await this._post("chat/completions", {
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

            data = await response.text()

            data = JSON.parse(data) as {
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

            if (data.choices && data.choices.length > 0) {
                return data as ChatCompletionResponse
            }

            throw new Error("error when calling openai embeddings, Result: " + JSON.stringify(data))

        } catch (e) {

            logger.error(data)
            logger.error(
                "Error when calling openai chat, Result: " + e.response
                    ? (e.response ? e.response.data : e)
                    : e
            );


            return null
        }
    }

    async chatWithFunctions(
        model: string,
        messages: BaseChatMessage[],
        signal?: AbortSignal,
        functions?: ChatCompletionFunctions[],
        stop?: string | string[]
    ) {

        let responseRawString: string

        try {
            const response = await this._post("chat/completions", {
                model: model,
                messages: messages.map((message) => {
                    return {
                        role: messageTypeToOpenAIRole(message._getType()),
                        content: message.text,
                        name: (message instanceof FunctionChatMessage) ? message.name : undefined,
                    }
                }),
                functions,
                stop,
                max_tokens: this.config.maxTokens,
                temperature: this.config.temperature,
                presence_penalty: this.config.presencePenalty,
                frequency_penalty: this.config.frequencyPenalty,
                user: "user"
            }, {
                signal: signal
            })


            let responseRawString = await response.text()
            const data = JSON.parse(responseRawString) as ChatCompletionResponse

            if (data.choices && data.choices.length > 0) {
                return data
            }

            throw new Error("error when calling openai embeddings, Result: " + JSON.stringify(data))

        } catch (e) {

            logger.error(responseRawString)
            logger.error(
                "Error when calling openai chat, Result: " + e.response
                    ? (e.response ? e.response.data : e)
                    : e
            );


            return null
        }
    }

    async embeddings({
        model,
        input
    }: { model: string, input: string[] | string }) {
        let data: {
            id: string;
            object: string;
            created: number;
            model: string;
            data: Array<{
                embedding: number[];
                object: string | null;
                index: number
            }>;
            usage: {
                prompt_tokens: number,
                completion_tokens: number,
                total_tokens: number
            }
        } | any

        try {
            const response = await this._post("embeddings", {
                input,
                model
            })

            data = await response.text()

            data = JSON.parse(data) as {
                id: string;
                object: string;
                created: number;
                model: string;
                data: Array<{
                    embedding: number[];
                    object: string | null;
                    index: number
                }>;
                usage: {
                    prompt_tokens: number,
                    completion_tokens: number,
                    total_tokens: number
                }
            };

            if (data.data && data.data.length > 0) {
                return data
            }

            throw new Error("error when calling openai embeddings, Result: " + JSON.stringify(data))

        } catch (e) {

            logger.error(data)
            logger.error(
                "Error when calling openai embeddings, Result: " + e.response
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
        case "function":
            return "function";
        default:
            throw new Error(`Unknown message type: ${type}`);
    }
}

export interface ChatCompletionResponse {
    choices: Array<{
        index: number;
        finish_reason: string | null;
        delta: { content?: string; role?: string };
        message: ChatCompletionResponseMessage
    }>;
    id: string;
    object: string;
    created: number;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ChatCompletionResponseMessage {
    role: string,
    content?: string,
    function_call?: ChatCompletionRequestMessageFunctionCall
}


export interface ChatCompletionFunctions {
    'name': string;
    'description'?: string;
    'parameters'?: { [key: string]: any; };
}

export interface ChatCompletionRequestMessageFunctionCall {
    'name'?: string;
    'arguments'?: string;
}