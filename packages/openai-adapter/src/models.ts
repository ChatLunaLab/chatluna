import { CallbackManagerForLLMRun } from 'langchain/callbacks';
import { zodToJsonSchema } from "zod-to-json-schema";
import { AIChatMessage, BaseChatMessage, ChatGeneration, ChatMessage, ChatResult, HumanChatMessage, SystemChatMessage } from 'langchain/schema';
import { Api, ChatCompletionFunctions, ChatCompletionResponse, ChatCompletionResponseMessage, CreateEmbeddingRequest, CreateEmbeddingResponse, messageTypeToOpenAIRole } from './api';
import OpenAIPlugin from '.';

import { getModelNameForTiktoken } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/count_tokens";
import { ChatHubBaseChatModel, CreateParams } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { Embeddings, EmbeddingsParams } from 'langchain/embeddings/base';
import { chunkArray } from "@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/chunk";
import { StructuredTool } from 'langchain/tools';
import { BaseLanguageModelCallOptions } from 'langchain/dist/base_language';
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger';

const logger = createLogger("@dingyi222666/chathub-openai-adapter/models");

interface TokenUsage {
    completionTokens?: number;
    promptTokens?: number;
    totalTokens?: number;
}

interface OpenAILLMOutput {
    tokenUsage: TokenUsage;
}


function openAIResponseToChatMessage(
    message: ChatCompletionResponseMessage
): BaseChatMessage {
    switch (message.role) {
        case "user":
            return new HumanChatMessage(message.content || "");
        case "assistant":
            return new AIChatMessage(message.content || "", {
                function_call: message.function_call,
            });
        case "system":
            return new SystemChatMessage(message.content || "");
        default:
            return new ChatMessage(message.content || "", message.role ?? "unknown");
    }
}

export function formatToOpenAIFunction(
    tool: StructuredTool
): ChatCompletionFunctions {
    return {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.schema),
    };
}

export interface OpenAIChatCallOptions extends BaseLanguageModelCallOptions {
    functions?: ChatCompletionFunctions[];
    tools?: StructuredTool[];
    signal?: AbortSignal;
    timeout?: number;
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
    extends ChatHubBaseChatModel {

    logitBias?: Record<string, number>;

    modelName = "gpt-3.5-turbo";

    timeout?: number;

    maxTokens?: number;

    private _polyfill = false

    private _client: Api;

    constructor(
        modelName: string,
        private readonly config: OpenAIPlugin.Config,
        inputs: CreateParams
    ) {
        super({
            maxRetries: config.maxRetries
        });
        this.modelName = modelName;

        this.maxTokens = config.maxTokens;
        this.timeout = config.timeout;
        this._client = inputs.client ?? new Api(config);
    }

    declare CallOptions: OpenAIChatCallOptions;

    get callKeys(): (keyof OpenAIChatCallOptions)[] {
        return ["stop", "signal", "timeout",  /* "options", */  "functions", "tools"];
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
            stop: null,
            functions: null,
            tools: null,
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
        options?: this["ParsedCallOptions"],
        callbacks?: CallbackManagerForLLMRun
    ): Promise<ChatResult> {
        const tokenUsage: TokenUsage = {};

        const params = this.invocationParams();

        params.stop = options?.stop ?? params.stop;
        params.functions =
            options?.functions ??
            (options?.tools ? options?.tools.map(formatToOpenAIFunction) : undefined);

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
            const text = part.message?.content ?? "";
            generations.push({
                text,
                message: openAIResponseToChatMessage(
                    part.message ?? { role: "assistant" }
                ),
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
            messages: BaseChatMessage[],
            stop?: string[] | string
        },
        options?: {
            signal?: AbortSignal;
            timeout?: number,
            stop?: string[] | string
        }
    ) {
        return this.caller
            .call(
                async (
                    request: {
                        model: string,
                        messages: BaseChatMessage[],
                        stop?: string[] | string,
                        functions?: ChatCompletionFunctions[],
                    },
                    options?: {
                        signal?: AbortSignal;
                        timeout?: number;

                    }
                ) => new Promise<ChatCompletionResponse>(
                    async (resolve, reject) => {

                        const timeout = setTimeout(
                            () => {
                                reject(Error("Timeout for request openai"))
                            }, options.timeout ?? 1000 * 120
                        )

                        let data: ChatCompletionResponse

                        if (request.functions) {
                            if (/* request.model === "gpt-4-0613" || request.model === "gpt-3.5-turbo-0613" */ request.model.includes("0613")) {
                                logger.debug("chatWithFunctions")
                                data = await this._client.chatWithFunctions(request.model, request.messages, options.signal, request.functions, request.stop)
                            } else {
                                reject(Error(`Function calling is not supported for model ${request.model}`))
                            }
                        } else {
                            data = await this._client.chatTrubo(request.model, request.messages, options.signal, request.stop)
                        }

                        clearTimeout(timeout)

                        resolve(data)
                    }),
                request,
                options
            )
    }

    _llmType() {
        return "openai";
    }

    _modelType() {
        if (this._polyfill) {
            return "base_chat_model"
        } else {
            return this.modelName
        }
    }


    async polyfill(f: (llm: ChatHubBaseChatModel) => Promise<void>): Promise<void> {
        this._polyfill = true
        await f(this)
        this._polyfill = false
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


export interface OpenAIEmbeddingsParams extends EmbeddingsParams {

    /**
     * Timeout to use when making requests to OpenAI.
     */
    timeout?: number;

    /**
     * The maximum number of documents to embed in a single request. This is
     * limited by the OpenAI API to a maximum of 2048.
     */
    batchSize?: number;

    /**
     * Whether to strip new lines from the input text. This is recommended by
     * OpenAI, but may not be suitable for all use cases.
     */
    stripNewLines?: boolean;

    maxRetries?: number

    client?: Api
}


export class OpenAIEmbeddings
    extends Embeddings
    implements OpenAIEmbeddingsParams {
    modelName = "text-embedding-ada-002";

    batchSize = 512;

    stripNewLines = true;

    timeout?: number;

    private _client: Api;


    constructor(
        private readonly config: OpenAIPlugin.Config,
        fields?: OpenAIEmbeddingsParams,
    ) {

        super(fields ?? {
            maxRetries: config.maxRetries
        });


        this.batchSize = fields?.batchSize ?? this.batchSize;
        this.stripNewLines = fields?.stripNewLines ?? this.stripNewLines;
        this.timeout = fields?.timeout ?? this.config.timeout ?? 1000 * 60

        this._client = fields?.client ?? new Api(config)
    }

    async embedDocuments(texts: string[]): Promise<number[][]> {
        const subPrompts = chunkArray(
            this.stripNewLines ? texts.map((t) => t.replaceAll("\n", " ")) : texts,
            this.batchSize
        );

        const embeddings: number[][] = [];

        for (let i = 0; i < subPrompts.length; i += 1) {
            const input = subPrompts[i];
            const { data } = await this._embeddingWithRetry({
                model: this.modelName,
                input,
            });
            for (let j = 0; j < input.length; j += 1) {
                embeddings.push(data[j].embedding);
            }
        }

        return embeddings;
    }

    async embedQuery(text: string): Promise<number[]> {
        const { data } = await this._embeddingWithRetry({
            model: this.modelName,
            input: this.stripNewLines ? text.replaceAll("\n", " ") : text,
        });
        return data[0].embedding;
    }

    private _embeddingWithRetry(request: CreateEmbeddingRequest) {
        return this.caller.call(
            async (
                request: CreateEmbeddingRequest,
            ) => new Promise<CreateEmbeddingResponse>(
                async (resolve, reject) => {

                    const timeout = setTimeout(
                        () => {
                            throw new Error("Timeout for request openai")
                        }, this.timeout ?? 1000 * 30)


                    const data = await this._client.embeddings(request)

                    clearTimeout(timeout)

                    if (data && data?.data) {
                        resolve(data)
                        return
                    }

                    reject(Error("error when calling openai embeddings, Result: " + JSON.stringify(data)))
                }),
            request,
        );
    }
}