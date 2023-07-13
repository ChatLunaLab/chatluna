import { ChatHubBaseChatModel } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { BingChatClient } from './client';
import BingChatPlugin from '.';
import { AIChatMessage, BaseChatMessage, ChatResult } from 'langchain/schema';
import { CallbackManagerForLLMRun, Callbacks } from 'langchain/callbacks';
import { BingConversationStyle } from './types';

export class BingChatModel
    extends ChatHubBaseChatModel {

    modelName = "bing";

    timeout?: number;

    maxTokens?: number;

    private _client: BingChatClient

    constructor(
        private readonly config: BingChatPlugin.Config,
        modelName: string
    ) {
        super({
            maxRetries: config.maxRetries
        });

        this.timeout = config.timeout;
        this.modelName = modelName
        this._client = new BingChatClient(config)
    }

    /**
     * Get the parameters used to invoke the model
     */
    invocationParams() {
        return {
            model: this.modelName,
        };
    }

    /** @ignore */
    _identifyingParams() {
        return {
            model_name: this.modelName,
            ...this.invocationParams()
        };
    }

    /**
     * Get the identifying parameters for the model
     */
    identifyingParams() {
        return this._identifyingParams();
    }


    getModelMaxContextSize(): number {
        return 8192
    }

    /** @ignore */
    async _generate(
        messages: BaseChatMessage[],
        options: this["ParsedCallOptions"],
        callbacks?: CallbackManagerForLLMRun
    ): Promise<ChatResult> {

        const lastMessage = messages[messages.length - 1];

        if (lastMessage._getType() !== "human" && this.config.sydney !== true) {
            throw new Error("The last message must be a human message");
        }

        const prompt = lastMessage.text

        const data = await this.completionWithRetry(
            {
                message: prompt,
                messages
            }
            ,
            {
                signal: options?.signal,
                timeout: this.config.timeout
            }
        );

        const response = data[0]

        const additionalReplyMessages = data.slice(1)

        return {
            generations: [{
                text: response.text,
                message: response,
                generationInfo: {
                    additionalReplyMessages: additionalReplyMessages.map(message => message.text)
                }
            }]
        };
    }


    async clearContext(): Promise<void> {
        this._client.clear()
    }

    /** @ignore */
    async completionWithRetry(
        requests: {
            message: string,
            messages: BaseChatMessage[]
        },
        options?: {
            signal?: AbortSignal;
            timeout?: number
        }
    ) {
        return this.caller
            .call(

                (
                    { message, messages }: {
                        message: string,
                        messages: BaseChatMessage[]
                    },
                    options?: {
                        signal?: AbortSignal;
                        timeout?: number;
                    }
                ) => new Promise<BaseChatMessage[]>(
                    async (resolve, reject) => {
                        const timeout = setTimeout(
                            () => {
                                reject("Timeout for request new bing")
                            }, options.timeout ?? 1000 * 120
                        )

                        try {
                            const data = await this._client.ask({
                                message,
                                sydney: this.config.sydney,
                                previousMessages: messages,
                                style: this.modelName as BingConversationStyle
                            })

                            resolve(data)
                        } catch (e) {
                            reject(e)
                        }
                        finally {
                            clearTimeout(timeout)
                        }
                    }),
                requests,
                options
            )
    }

    _llmType() {
        return "newbing";
    }

    _modelType() {
        return this.modelName
    }

    /** @ignore */
    _combineLLMOutput() {
        return []
    }
}
