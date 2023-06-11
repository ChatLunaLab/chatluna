import { CallbackManagerForLLMRun } from 'langchain/callbacks';
import { BaseChatModel } from 'langchain/chat_models/base';
import { encodingForModel } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/tiktoken"
import { AIChatMessage, BaseChatMessage, ChatGeneration, ChatMessage, ChatResult, HumanChatMessage, SystemChatMessage } from 'langchain/schema';
import { Api } from './api';
import OpenAIPlugin from '.';
import { getModelNameForTiktoken } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/count_tokens";
import { ChatHubBaseChatModel, CreateParams } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { Embeddings, EmbeddingsParams } from 'langchain/embeddings/base';
import { chunkArray } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/chunk";
import CopilotHubPlugin from '.';
import { PoeMessage } from './types';
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger';
import PoePlugin from '.';


const logger = createLogger("@dingyi222666/chathub-poe-adapter/model");

export class PoeChatModel
    extends ChatHubBaseChatModel {

    // 
    modelName = "gpt-3.5-turbo";

    timeout?: number;

    maxTokens?: number;

    private _client: Api;

    constructor(
        private readonly config: PoePlugin.Config,
        private inputs: CreateParams
    ) {
        super({
            maxRetries: config.maxRetries
        });


        this.modelName = inputs.modelName ?? this.modelName;
        this.timeout = config.timeout;
        this._client = inputs.client ?? new Api(config);
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
        if (!this.config.formatMessages) {
            const lastMessage = messages[messages.length - 1];

            if (lastMessage._getType() !== "human") {
                throw new Error("Last message must be human message")
            }

            return lastMessage.text;
        }

        const maxTokenCount = () => {
            const model = this._modelType().toLowerCase()

            if (model.includes("100k")) {
                return 100000
            } else if (model.includes("gpt-4")) {
                return 8056
            } else {
                return 4096
            }
        }

        return await this._formatMessages(messages, async (text) => text.length / 4,
            maxTokenCount())
    }


    private _parseResponse(response: string) {
        if (!this.config.formatMessages) {
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


    /** @ignore */
    async completionWithRetry(
        prompt: string
    ) {
        return this.caller
            .call(
                async (
                    prompt: string
                ) => {
                    const data = await this._client.request(this.modelName, prompt)

                    if (data instanceof Error) {
                        throw data
                    }

                    return data
                },
                prompt
            )
    }

    async clearContext(): Promise<void> {
        await this._client.clearContext(this.modelName)
    }

    _llmType() {
        return "poe";
    }

    _modelType() {
        return this.modelName
    }

    /** @ignore */
    _combineLLMOutput() {
        return []
    }
}
