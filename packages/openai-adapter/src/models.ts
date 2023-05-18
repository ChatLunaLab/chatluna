import { CallbackManagerForLLMRun } from 'langchain/callbacks';
import { BaseChatModel, BaseChatModelParams } from 'langchain/chat_models/base';

import { AIChatMessage, BaseChatMessage, ChatGeneration, ChatMessage, ChatResult, HumanChatMessage, SystemChatMessage } from 'langchain/schema';
import { Api, messageTypeToOpenAIRole } from './api';
import OpenAIPlugin from '.';
import { getModelNameForTiktoken } from "@dingyi222666/chathub-llm-core/lib/utils/count_tokens";
import { CreateParams } from '@dingyi222666/chathub-llm-core/lib/model/base';


interface TokenUsage {
    completionTokens?: number;
    promptTokens?: number;
    totalTokens?: number;
}

interface OpenAILLMOutput {
    tokenUsage: TokenUsage;
}


function openAIResponseToChatMessage(
    role: string,
    text: string
): BaseChatMessage {
    switch (role) {
        case "user":
            return new HumanChatMessage(text);
        case "assistant":
            return new AIChatMessage(text);
        case "system":
            return new SystemChatMessage(text);
        default:
            return new ChatMessage(text, role ?? "unknown");
    }
}

/**
 * Wrapper around OpenAI large language models that use the Chat endpoint.
 *
 * To use you should have the `openai` package installed, with the
 * `OPENAI_API_KEY` environment variable set.
 *
 * To use with Azure you should have the `openai` package installed, with the
 * `AZURE_OPENAI_API_KEY`,
 * `AZURE_OPENAI_API_INSTANCE_NAME`,
 * `AZURE_OPENAI_API_DEPLOYMENT_NAME`
 * and `AZURE_OPENAI_API_VERSION` environment variable set.
 *
 * @remarks
 * Any parameters that are valid to be passed to {@link
 * https://platform.openai.com/docs/api-reference/chat/create |
 * `openai.createCompletion`} can be passed through {@link modelKwargs}, even
 * if not explicitly available on this class.
 */
export class OpenAIChatModel
    extends BaseChatModel {

    logitBias?: Record<string, number>;

    modelName = "gpt-3.5-turbo";

    timeout?: number;

    maxTokens?: number;

    private _systemPrompts?: BaseChatMessage[]

    private _client: Api;

    constructor(
        modelName: string,
        private readonly config: OpenAIPlugin.Config,
        private inputs: CreateParams
    ) {
        super({});
        this.modelName = modelName;

        this.maxTokens = config.maxTokens;
        this.timeout = config.timeout;
        this._client = new Api(config);
        this._systemPrompts = inputs.systemPrompts
    }



    /**
     * Get the parameters used to invoke the model
     */
    invocationParams() {
        return {
            model: this.modelName,
            temperature: this.config.temperature,
            top_p: 1,
            frequency_penalty: this.config.frequencyPenalty,
            presence_penalty: this.config.presencePenalty,
            max_tokens: this.maxTokens === -1 ? undefined : this.maxTokens,
            stop: null
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
        const tokenUsage: TokenUsage = {};


        const params = this.invocationParams();


        params.stop = options?.stop ?? params.stop;

        const data = await this.completionWithRetry(
            {
                ...params,
                messages: messages,
            },
            {
                signal: options?.signal,
                timeout: this.config.timeout
            }
        );

        const {
            completion_tokens: completionTokens,
            prompt_tokens: promptTokens,
            total_tokens: totalTokens,
        } = data.usage ?? {};

        if (completionTokens) {
            tokenUsage.completionTokens =
                (tokenUsage.completionTokens ?? 0) + completionTokens;
        }

        if (promptTokens) {
            tokenUsage.promptTokens = (tokenUsage.promptTokens ?? 0) + promptTokens;
        }

        if (totalTokens) {
            tokenUsage.totalTokens = (tokenUsage.totalTokens ?? 0) + totalTokens;
        }

        const generations: ChatGeneration[] = [];
        for (const part of data.choices) {
            const role = part.message?.role ?? undefined;
            const text = part.message?.content ?? "";
            generations.push({
                text,
                message: openAIResponseToChatMessage(role, text),
            });
        }
        return {
            generations,
            llmOutput: { tokenUsage },
        };
    }

    async getNumTokensFromMessages(messages: BaseChatMessage[]): Promise<{
        totalCount: number;
        countPerMessage: number[];
    }> {
        let totalCount = 0;
        let tokensPerMessage = 0;
        let tokensPerName = 0;

        // From: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_format_inputs_to_ChatGPT_models.ipynb
        if (getModelNameForTiktoken(this.modelName) === "gpt-3.5-turbo") {
            tokensPerMessage = 4;
            tokensPerName = -1;
        } else if (getModelNameForTiktoken(this.modelName).startsWith("gpt-4")) {
            tokensPerMessage = 3;
            tokensPerName = 1;
        }

        const countPerMessage = await Promise.all(
            messages.map(async (message) => {
                const textCount = await this.getNumTokens(message.text);
                const roleCount = await this.getNumTokens(
                    messageTypeToOpenAIRole(message._getType())
                );
                const nameCount =
                    message.name !== undefined
                        ? tokensPerName + (await this.getNumTokens(message.name))
                        : 0;
                const count = textCount + tokensPerMessage + roleCount + nameCount;

                totalCount += count;
                return count;
            })
        );

        totalCount += 3; // every reply is primed with <|start|>assistant<|message|>

        return { totalCount, countPerMessage };
    }

    /** @ignore */
    async completionWithRetry(
        request: {
            model: string;
            messages: BaseChatMessage[]
        },
        options?: {
            signal?: AbortSignal;
            timeout?: number
        }
    ) {
        return this.caller
            .call(
                async (
                    request: {
                        model: string,
                        messages: BaseChatMessage[]
                    },
                    options?: {
                        signal?: AbortSignal;
                        timeout?: number;
                    }
                ) => {

                    const timeout = setTimeout(
                        () => {
                            throw new Error("Timeout for request openai")
                        }, options.timeout ?? 1000 * 120
                    )

                    const data = await this._client.chatTrubo(request.model, request.messages, options.signal)

                    clearTimeout(timeout)

                    return data
                },
                request,
                options
            )
    }

    _llmType() {
        return "openai";
    }

    _modelType() {
        return this.modelName
    }

    /** @ignore */
    _combineLLMOutput(...llmOutputs: OpenAILLMOutput[]): OpenAILLMOutput {
        return llmOutputs.reduce<{
            [key in keyof OpenAILLMOutput]: Required<OpenAILLMOutput[key]>;
        }>(
            (acc, llmOutput) => {
                if (llmOutput && llmOutput.tokenUsage) {
                    acc.tokenUsage.completionTokens +=
                        llmOutput.tokenUsage.completionTokens ?? 0;
                    acc.tokenUsage.promptTokens += llmOutput.tokenUsage.promptTokens ?? 0;
                    acc.tokenUsage.totalTokens += llmOutput.tokenUsage.totalTokens ?? 0;
                }
                return acc;
            },
            {
                tokenUsage: {
                    completionTokens: 0,
                    promptTokens: 0,
                    totalTokens: 0,
                },
            }
        );
    }
}