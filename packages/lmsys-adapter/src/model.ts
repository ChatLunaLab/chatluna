import { ChatHubBaseChatModel } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { LmsysClient } from './client';
import LmsysPlugin from '.';
import { BaseMessage, ChatResult } from 'langchain/schema';
import { CallbackManagerForLLMRun, Callbacks } from 'langchain/callbacks';


export class LmsysModel
    extends ChatHubBaseChatModel {

    modelName = "";

    timeout?: number;

    maxTokens?: number;

    private _client: LmsysClient

    constructor(
        private readonly config: LmsysPlugin.Config,
        modelName: string
    ) {
        super({
            maxRetries: config.maxRetries
        });

        this.timeout = config.timeout;
        this.modelName = modelName
        this._client = new LmsysClient(modelName)
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
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        callbacks?: CallbackManagerForLLMRun
    ): Promise<ChatResult> {

        const lastMessage = messages[messages.length - 1];


        const prompt = lastMessage.content

        const data = await this.completionWithRetry(
            {
                message: prompt,
                messages
            },
            {
                signal: options?.signal,
                timeout: this.config.timeout
            }
        );

        return {
            generations: [{
                text: data.content,
                message: data
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
            messages: BaseMessage[]
        },
        options?: {
            signal?: AbortSignal;
            timeout?: number
        }
    ) {
        return this.caller
            .call(
                async (
                    { message, messages }: {
                        message: string,
                        messages: BaseMessage[]
                    },
                    options?: {
                        signal?: AbortSignal;
                        timeout?: number;
                    }
                ) => {

                    const timeout = setTimeout(
                        () => {
                            throw new Error("Timeout for request lmsys-adapter")
                        }, options.timeout ?? 1000 * 120
                    )

                    const data = await this._client.ask({
                        message,
                        previousMessages: messages
                    })

                    clearTimeout(timeout)

                    return data
                },
                requests,
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
