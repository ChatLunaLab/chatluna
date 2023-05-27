import { CallbackManagerForLLMRun } from 'langchain/callbacks';
import { BaseChatModel } from 'langchain/chat_models/base';
import { encodingForModel } from "@dingyi222666/chathub-llm-core/lib/utils/tiktoken"
import { AIChatMessage, BaseChatMessage, ChatGeneration, ChatMessage, ChatResult, HumanChatMessage, SystemChatMessage } from 'langchain/schema';
import { Api } from './api';
import OpenAIPlugin from '.';
import { getModelNameForTiktoken } from "@dingyi222666/chathub-llm-core/lib/utils/count_tokens";
import { ChatHubBaseChatModel, CreateParams } from '@dingyi222666/chathub-llm-core/lib/model/base';
import { Embeddings, EmbeddingsParams } from 'langchain/embeddings/base';
import { chunkArray } from "@dingyi222666/chathub-llm-core/lib/utils/chunk";
import CopilotHubPlugin from '.';
import { PoeMessage } from './types';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import PoePlugin from '.';


const logger = createLogger("@dingyi222666/chathub-copilothub-adapter/model");

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

    private _generatePrompt(messages: BaseChatMessage[]) {
        if (!this.config.formatMessages) {
            const lastMessage = messages[messages.length - 1];

            if (lastMessage._getType() !== "human") {
                throw new Error("Last message must be human message")
            }

            return lastMessage.text;
        }


        const result: string[] = []

        messages.reverse().forEach((chatMessage) => {
            const data = {
                role: chatMessage._getType(),
                name: chatMessage.name,
                content: chatMessage.text,
            }
            result.push(JSON.stringify(data))
        })

        //等待补全
        const buffer = []

        buffer.push('[')

        for (const text of result) {
            buffer.push(text)
            buffer.push(',')
        }

        return buffer.join('')
    }


    private _parseResponse(response: string) {
        if (!this.config.formatMessages) {
            return response;
        }

        try {
            const decodeContent = JSON.parse(response) as PoeMessage

            // check decodeContent fields is PoeMessage

            if (decodeContent.content && decodeContent.name && decodeContent.role) {
                return decodeContent.content
            }
        } catch (e) {
            logger.error(`decode error: ${e.message}`)
        }

        const matchContent = response.trim()
            .replace(/^[^{]*{/g, "{")
            .replace(/}[^}]*$/g, "}")
            .match(/"content":"(.*?)"/)?.[1] || response.match(/"content": '(.*?)'/)?.[1] ||
            response.match(/"content": "(.*?)/)?.[1] || response.match(/"content":'(.*?)/)?.[1]

        if (matchContent) {
            return matchContent
        }
    }

    /** @ignore */
    async _generate(
        messages: BaseChatMessage[],
        options?: Record<string, any>,
        runManager?: CallbackManagerForLLMRun
    ): Promise<ChatResult> {

        const prompt = this._generatePrompt(messages);

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
