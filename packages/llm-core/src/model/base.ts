import type { Tiktoken } from "@dqbd/tiktoken";
import { BaseCache, BasePromptValue, CallbackManager, Callbacks, Generation, LLMResult, getModelNameForTiktoken, importTiktoken } from '../common';
import { AsyncCaller, AsyncCallerParams } from '../utils/async_caller';
import { InMemoryCache } from '../cache';

const getVerbosity = () => false;

export interface BaseLLMChainParams {
    verbose?: boolean;
    callbacks?: Callbacks;
}

/**
 * Base class for language models, chains, tools.
 */
export abstract class BaseLLMChain implements BaseLLMChainParams {
    /**
     * Whether to print out response text.
     */
    verbose: boolean;

    callbacks?: Callbacks;

    constructor(params: BaseLLMChainParams) {
        this.verbose = params.verbose ?? getVerbosity();
        this.callbacks = params.callbacks;
    }
}

/**
 * Base interface for language model parameters.
 * A subclass of {@link BaseLanguageModel} should have a constructor that
 * takes in a parameter that extends this interface.
 */
export interface BaseLanguageModelParams
    extends AsyncCallerParams,
    BaseLLMChainParams {
    /**
     * @deprecated Use `callbacks` instead
     */
    callbackManager?: CallbackManager;
}

export interface BaseLanguageModelCallOptions { }

/**
 * Base class for language models.
 */
export abstract class BaseLanguageModel
    extends BaseLLMChain
    implements BaseLanguageModelParams {
    declare CallOptions: BaseLanguageModelCallOptions;

    /**
     * The async caller should be used by subclasses to make any async calls,
     * which will thus benefit from the concurrency and retry logic.
     */
    caller: AsyncCaller;

    constructor(params: BaseLanguageModelParams) {
        super({
            verbose: params.verbose,
            callbacks: params.callbacks ?? params.callbackManager,
        });
        this.caller = new AsyncCaller(params ?? {});
    }

    abstract generatePrompt(
        promptValues: BasePromptValue[],
        stop?: string[] | this["CallOptions"],
        callbacks?: Callbacks
    ): Promise<LLMResult>;

    abstract _modelType(): string;

    abstract _llmType(): string;

    private _encoding?: Tiktoken;

    private _registry?: FinalizationRegistry<Tiktoken>;

    async getNumTokens(text: string) {
        // fallback to approximate calculation if tiktoken is not available
        let numTokens = Math.ceil(text.length / 4);

        try {
            if (!this._encoding) {
                const { encoding_for_model } = await importTiktoken();
                // modelName only exists in openai subclasses, but tiktoken only supports
                // openai tokenisers anyway, so for other subclasses we default to gpt2
                if (encoding_for_model) {
                    this._encoding = encoding_for_model(
                        "modelName" in this
                            ? getModelNameForTiktoken(this.modelName as string)
                            : "gpt2"
                    );
                    // We need to register a finalizer to free the tokenizer when the
                    // model is garbage collected.
                    this._registry = new FinalizationRegistry((t) => t.free());
                    this._registry.register(this, this._encoding);
                }
            }

            if (this._encoding) {
                numTokens = this._encoding.encode(text).length;
            }
        } catch (error) {
            console.warn(
                "Failed to calculate number of tokens with tiktoken, falling back to approximate count",
                error
            );
        }

        return numTokens;
    }

    /**
     * Get the identifying parameters of the LLM.
     */
    _identifyingParams(): Record<string, any> {
        return {};
    }

}


export interface BaseLLMParams extends BaseLanguageModelParams {
    /**
     * @deprecated Use `maxConcurrency` instead
     */
    concurrency?: number;
    cache?: BaseCache | boolean;
}

export interface BaseLLMCallOptions extends BaseLanguageModelCallOptions { }

/**
 * LLM Wrapper. Provides an {@link call} (an {@link generate}) function that takes in a prompt (or prompts) and returns a string.
 */
export abstract class BaseLLM extends BaseLanguageModel {
    declare CallOptions: BaseLanguageModelCallOptions;

    cache?: BaseCache;

    constructor({ cache, concurrency, ...rest }: BaseLLMParams) {
        super(concurrency ? { maxConcurrency: concurrency, ...rest } : rest);
        if (typeof cache === "object") {
            this.cache = cache;
        } else if (cache) {
            this.cache = InMemoryCache.global();
        } else {
            this.cache = undefined;
        }
    }

    async generatePrompt(
        promptValues: BasePromptValue[],
        stop?: string[] | this["CallOptions"],
        callbacks?: Callbacks
    ): Promise<LLMResult> {
        const prompts: string[] = promptValues.map((promptValue) =>
            promptValue.toString()
        );
        return this.generate(prompts, stop, callbacks);
    }

    /**
     * Run the LLM on the given prompts and input.
     */
    abstract _generate(
        prompts: string[],
        stop?: string[] | this["CallOptions"],
        callbacks?: Callbacks
    ): Promise<LLMResult>;

    /** @ignore */
    async _generateUncached(
        prompts: string[],
        stop?: string[] | this["CallOptions"],
        callbacks?: Callbacks
    ): Promise<LLMResult> {
        const callbackManager_ = await CallbackManager.configure(
            callbacks,
            this.callbacks
        );


        await callbackManager_?.handleLLMStart(
            { name: this._llmType() },
            prompts
        );
        let output: LLMResult | PromiseLike<LLMResult>;
        try {
            output = await this._generate(prompts, stop, callbacks);
        } catch (err) {
            await callbackManager_?.handleLLMError(err);
            throw err;
        }

        await callbackManager_?.handleLLMEnd(output);

        return output;
    }

    /**
     * Run the LLM on the given propmts an input, handling caching.
     */
    async generate(
        prompts: string[],
        stop?: string[] | this["CallOptions"],
        callbacks?: Callbacks
    ): Promise<LLMResult> {
        if (!Array.isArray(prompts)) {
            throw new Error("Argument 'prompts' is expected to be a string[]");
        }

        if (!this.cache) {
            return this._generateUncached(prompts, stop, callbacks);
        }

        const { cache } = this;
        const params = this.serialize();
        params.stop = stop;

        const llmStringKey = `${Object.entries(params).sort()}`;
        const missingPromptIndices: number[] = [];
        const generations = await Promise.all(
            prompts.map(async (prompt, index) => {
                const result = await cache.lookup(prompt, llmStringKey);
                if (!result) {
                    missingPromptIndices.push(index);
                }
                return result;
            })
        );

        let llmOutput = {};
        if (missingPromptIndices.length > 0) {
            const results = await this._generateUncached(
                missingPromptIndices.map((i) => prompts[i]),
                stop,
                callbacks
            );
            await Promise.all(
                results.generations.map(async (generation, index) => {
                    const promptIndex = missingPromptIndices[index];
                    generations[promptIndex] = generation;
                    return cache.update(prompts[promptIndex], llmStringKey, generation);
                })
            );
            llmOutput = results.llmOutput ?? {};
        }

        return { generations, llmOutput } as LLMResult;
    }

    /**
     * Convenience wrapper for {@link generate} that takes in a single string prompt and returns a single string output.
     */
    async call(
        prompt: string,
        stop?: string[] | this["CallOptions"],
        callbacks?: Callbacks
    ) {
        const { generations } = await this.generate([prompt], stop, callbacks);
        return generations[0][0].text;
    }


    /**
  * Return a json-like object representing this LLM.
  */
    serialize(): Record<string, any> {
        return {
            ...this._identifyingParams(),
            _type: this._llmType(),
            _model: this._modelType(),
        };
    }

    /**
     * Get the identifying parameters of the LLM.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _identifyingParams(): Record<string, any> {
        return {};
    }

    /**
     * Return the string type key uniquely identifying this class of LLM.
     */
    abstract _llmType(): string;



    _modelType(): string {
        return "base_llm" as const;
    }

}

/**
 * LLM class that provides a simpler interface to subclass than {@link BaseLLM}.
 *
 * Requires only implementing a simpler {@link _call} method instead of {@link _generate}.
 *
 * @augments BaseLLM
 */
export abstract class LLM extends BaseLLM {
    /**
     * Run the LLM on the given prompt and input.
     */
    abstract _call(
        prompt: string,
        stop?: string[] | this["CallOptions"],
        callbacks?: Callbacks
    ): Promise<string>;

    async _generate(
        prompts: string[],
        stop?: string[] | this["CallOptions"],
        callbacks?: Callbacks
    ): Promise<LLMResult> {
        const generations: Generation[][] = [];
        for (let i = 0; i < prompts.length; i += 1) {
            const text = await this._call(prompts[i], stop, callbacks);
            generations.push([{ text }]);
        }
        return { generations };
    }
}