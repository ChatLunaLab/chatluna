import { Tiktoken } from 'js-tiktoken';
import { BaseChatModel, BaseChatModelCallOptions } from 'langchain/chat_models/base';
import { BaseLanguageModelCallOptions } from 'langchain/dist/base_language';
import { ModelRequestParams, ModelRequester } from './api';
import { CallbackManagerForLLMRun } from 'langchain/callbacks';
import { AIMessage, AIMessageChunk, BaseMessage, ChatGeneration, ChatGenerationChunk, ChatResult } from 'langchain/schema';
import { encodingForModel } from '../utils/tiktoken';
import { getModelContextSize, getModelNameForTiktoken } from '../utils/count_tokens';
import { createLogger } from '../utils/logger';
import { StructuredTool } from 'langchain/tools';

const logger = createLogger("@dingyi222666/chathub/llm-core/model/base");

export interface ChatHubModelCallOptions extends BaseChatModelCallOptions {

    model: string

    /** Sampling temperature to use */
    temperature?: number;

    /**
     * Maximum number of tokens to generate in the completion. -1 returns as many
     * tokens as possible given the prompt and the model's maximum context size.
     */
    maxTokens?: number;

    /** Total probability mass of tokens to consider at each step */
    topP?: number;

    /** Penalizes repeated tokens according to frequency */
    frequencyPenalty?: number;

    /** Penalizes repeated tokens */
    presencePenalty?: number;

    /** Number of completions to generate for each prompt */
    n?: number;

    /** Dictionary used to adjust the probability of specific tokens being generated */
    logitBias?: Record<string, number>;

    stream: boolean

    tools?: StructuredTool[];
}

export interface ChatHubModelInput extends ChatHubModelCallOptions {
    llmType?: string


    requester: ModelRequester
}



export class ChatHubChatModel extends BaseChatModel<ChatHubModelCallOptions> {

    protected __encoding: Tiktoken

    private _requester: ModelRequester
    private _modelName: string


    lc_serializable = false;

    constructor(private _options: ChatHubModelInput) {
        super(_options)
        this._requester = _options.requester
        this._modelName = _options.model
    }

    get callKeys(): (keyof ChatHubModelCallOptions)[] {
        return [
            ...(super.callKeys as (keyof ChatHubModelCallOptions)[]),
        ];
    }

    /**
     * Get the parameters used to invoke the model
     */
    invocationParams(
        options?: this["ParsedCallOptions"]
    ): ChatHubModelCallOptions {
        const maxTokens = options?.maxTokens ?? this._options.maxTokens;
        return {
            model: options.model ?? this._options.model,
            temperature: options.temperature ?? this._options.temperature,
            topP: options.topP ?? this._options.topP,
            frequencyPenalty: options.frequencyPenalty ?? this._options.frequencyPenalty,
            presencePenalty: options.presencePenalty ?? this._options.presencePenalty,
            n: options.n ?? this._options.n,
            logitBias: options.logitBias ?? this._options.logitBias,
            maxTokens: maxTokens === -1 ? undefined : maxTokens,
            stop: options?.stop ?? this._options.stop,
            stream: options.stream ?? this._options.stream,
        };
    }

    async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun
    ): AsyncGenerator<ChatGenerationChunk> {
        const params = this.invocationParams(options);
        const stream = await this.createStreamWithRetry({
            ...params,
            input: messages
        })

        for await (const chunk of stream) {
            yield chunk
            // eslint-disable-next-line no-void
            void runManager?.handleLLMNewToken(chunk.text ?? "");
        }
    }

    async _generate(messages: BaseMessage[], options: this['ParsedCallOptions'], runManager?: CallbackManagerForLLMRun): Promise<ChatResult> {
        const params = this.invocationParams(options);
        let response: ChatGeneration
        if (params.stream) {

            const stream = this._streamResponseChunks(
                messages,
                options,
                runManager
            );
            for await (const chunk of stream) {
                response = chunk
            }
        } else {
            response = await this.completionWithRetry({
                ...params,
                input: messages
            });
        }

        return {
            generations: [response]
        }
    }

    /**
     ** Creates a streaming request with retry.
     * @param request The parameters for creating a completion.
     ** @returns A streaming request.
     */
    private async createStreamWithRetry(
        params: ModelRequestParams
    ) {
        const makeCompletionRequest = async () =>
            this._requester.completionStream(params);
        return this.caller.call(makeCompletionRequest);
    }

    /** @ignore */
    private async completionWithRetry(
        params: ModelRequestParams
    ) {
        const makeCompletionRequest = async () =>
            this._requester.completion(params);
        return this.caller.call(makeCompletionRequest);
    }

    async clearContext(): Promise<void> {
        await this._requester.dispose()

        this.caller
            .call(this._requester.init.bind(this._requester))
    }


    getModelMaxContextSize() {
        const modelName = this._modelName ?? "gpt2"
        return getModelContextSize(modelName)
    }


    async getNumTokens(text: string) {
        // fallback to approximate calculation if tiktoken is not available
        let numTokens = Math.ceil(text.length / 4);

        if (!this.__encoding) {
            try {
                this.__encoding = await encodingForModel(
                    "modelName" in this
                        ? getModelNameForTiktoken(this.modelName as string)
                        : "gpt2"
                );
            } catch (error) {
                logger.warn(
                    "Failed to calculate number of tokens, falling back to approximate count",
                    error
                );
            }
        }


        if (this.__encoding) {
            numTokens = this.__encoding.encode(text).length;
        }
        return numTokens;
    }

    _llmType(): string {
        return this._options.llmType ?? "openai"
    }

    _modelType(): string {
        return "base_chat_model"
    }


    /** @ignore */
    _combineLLMOutput(...llmOutputs: any[]): any {
    }

}
