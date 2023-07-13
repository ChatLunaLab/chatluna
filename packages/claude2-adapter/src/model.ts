import { ChatHubBaseChatModel } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { Claude2ChatClient } from './client';
import BingChatPlugin from '.';
import { AIChatMessage, BaseChatMessage, ChatResult } from 'langchain/schema';
import { CallbackManagerForLLMRun, Callbacks } from 'langchain/callbacks';
import { Api } from './api';
import Claude2ChatPlugin from '.';

export class Claude2ChatModel
    extends ChatHubBaseChatModel {

    modelName = "claude-2";

    timeout?: number;

    maxTokens?: number;

    private _client: Claude2ChatClient

    private _config: Claude2ChatPlugin.Config

    constructor(
        {
            config,
            modelName,
            api
        }: {
            config: Claude2ChatPlugin.Config,
            modelName: string
            api: Api
        }

    ) {
        super({
            maxRetries: config.maxRetries
        });

        this.timeout = config.timeout;
        this.modelName = modelName
        this._config = config
        this._client = new Claude2ChatClient(config, api)
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
        return 100000
    }

    async _formatMessages(messages: BaseChatMessage[],
        tokenCounter?: (text: string) => Promise<number>, maxTokenCount?: number) {
        const formatMessages: BaseChatMessage[] = [
            ...messages]

        const result: string[] = []

        let tokenCount = 0

        result.push("\nThe following is a friendly conversation between a user and an ai. The ai is talkative and provides lots of specific details from its context. The ai use the ai prefix. \n\n")

        tokenCount += await tokenCounter(result[result.length - 1])

        for (const message of formatMessages) {
            const roleType = message._getType() === "human" ? 'user' : message._getType()
            const formatted = `${roleType}: ${message.text}`

            const formattedTokenCount = await tokenCounter(formatted)

            if (tokenCount + formattedTokenCount > maxTokenCount) {
                break
            }

            result.push(formatted)

            tokenCount += formattedTokenCount
        }

        return result.join("\n\n")
    }


    private async _generatePrompt(messages: BaseChatMessage[]) {
        if (!this._config.formatMessages) {
            const lastMessage = messages[messages.length - 1];

            if (lastMessage._getType() !== "human") {
                throw new Error("Last message must be human message")
            }

            return lastMessage.text;
        }


        return await this._formatMessages(messages, async (text) => text.length / 3,
            this.getModelMaxContextSize())
    }


    private _parseResponse(response: string) {
        if (!this._config.formatMessages) {
            return response;
        }

        let result = response

        if (result.match(/^(.+?)(:|：)\s?/)) {
            result = result.replace(/^(.+?)(:|：)\s?/, '')
        }

        return result
    }


    /** @ignore */
    async _generate(
        messages: BaseChatMessage[],
        options?: Record<string, any>,
        callbacks?: CallbackManagerForLLMRun
    ): Promise<ChatResult> {

        const prompt = await this._generatePrompt(messages);

        const data = this._parseResponse(await this.completionWithRetry(
            prompt
        ))


        return {
            generations: [{
                text: data,
                message: new AIChatMessage(data)
            }]
        };
    }


    async clearContext(): Promise<void> {
        this._client.clear()
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

                (
                    prompt: string,
                    options?: {
                        signal?: AbortSignal;
                        timeout?: number;
                    }
                ) => new Promise<string>(
                    async (resolve, reject) => {
                        const timeout = setTimeout(
                            () => {
                                reject("Timeout for request claude")
                            }, options.timeout ?? 1000 * 120
                        )

                        try {
                            const data = await this._client.ask(prompt)

                            resolve(data)
                        } catch (e) {
                            reject(e)
                        }
                        finally {
                            clearTimeout(timeout)
                        }
                    }),
                prompt,
                options
            )
    }

    _llmType() {
        return "claude";
    }

    _modelType() {
        return this.modelName
    }

    /** @ignore */
    _combineLLMOutput() {
        return []
    }
}
