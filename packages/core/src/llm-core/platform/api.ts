import { AIMessage, AIMessageChunk, BaseMessage, ChatGeneration, ChatGenerationChunk } from 'langchain/schema';

export interface BaseRequestParams {
    /**
    * Timeout to use when making requests to OpenAI.
    */
    timeout?: number;
    /**
     ** The signal to use for cancellation.
     **/
    signal?: AbortSignal


    /** Model name to use */
    model: string;
}

export interface ModelRequestParams extends BaseRequestParams {
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

    /** Unique string identifier representing your end-user, which can help OpenAI to monitor and detect abuse. */
    user?: string;


    /** List of stop words to use when generating */
    stop?: string[] | string


    /**
     * Input messages to use for model completion.
     */
    input: BaseMessage[]

    functions?: ChatCompletionFunctions[]
}


export interface EmbeddingsRequestParams extends BaseRequestParams {
    input: string | string[]
}

export abstract class BaseRequester {
    async init() { }

    async dispose(): Promise<void> { }
}

export abstract class ModelRequester extends BaseRequester {
    async completion(params: ModelRequestParams): Promise<ChatGeneration> {
        const stream = this.completionStream(params)

        // get final result
        let result: ChatGeneration

        for await (const chunk of stream) {
            result = chunk
        }

        return result
    }

    abstract completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk>

}



export abstract class EmbeddingsRequester extends BaseRequester {
    abstract embeddings(params: EmbeddingsRequestParams): Promise<number[] | number[][]>
}


export interface ChatCompletionFunctions {
    'name': string;
    'description'?: string;
    'parameters'?: { [key: string]: any; };
}

