import { ChatHubBaseChatModel } from '@dingyi222666/chathub-llm-core/lib/model/base';
import BardPlugin from '.';
import { CallbackManagerForLLMRun } from 'langchain/callbacks';
import { AIChatMessage, BaseChatMessage, ChatResult } from 'langchain/schema';

import { Api } from './api';


export class BardChatModel
    extends ChatHubBaseChatModel {

    logitBias?: Record<string, number>;

    modelName = "bard";

    timeout?: number;

    maxTokens?: number;

    constructor(
        private readonly config: BardPlugin.Config,
        private readonly _client?: Api
    ) {
        super({
            maxRetries: config.maxRetries
        });

        this.timeout = config.timeout;
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

    /** @ignore */
    async _generate(
        messages: BaseChatMessage[],
        options?: Record<string, any>,
        runManager?: CallbackManagerForLLMRun
    ): Promise<ChatResult> {

        const lastMessage = messages[messages.length - 1];

        if (lastMessage._getType() !== "human") {
            throw new Error("The last message must be a human message");
        }

        const prompt = lastMessage.text

        const data = await this.completionWithRetry(
            prompt
            ,
            {
                signal: options?.signal,
                timeout: this.config.timeout
            }
        );


        return {
            generations: [{
                text: data,
                message: new AIChatMessage(data)
            }]
        };
    }


    async clearContext(): Promise<void> {
        this._client.clearConversation()
    }

    /** @ignore */
    async completionWithRetry(
        prompt: string,
        options?: {
            signal?: AbortSignal;
            timeout?: number
        }
    ) {
        return this.caller
            .call(
                async (
                    prompt: string,
                    options?: {
                        signal?: AbortSignal;
                        timeout?: number;
                    }
                ) => {

                    const timeout = setTimeout(
                        () => {
                            throw new Error("Timeout for request bard")
                        }, options.timeout ?? 1000 * 120
                    )

                    const data = await this._client.request(prompt, options.signal)

                    clearTimeout(timeout)

                    if (data instanceof Error) {
                        throw data
                    }

                    return data
                },
                prompt,
                options
            )
    }

    _llmType() {
        return "bard";
    }

    _modelType() {
        return this.modelName
    }

    /** @ignore */
    _combineLLMOutput() {
        return []
    }
}
