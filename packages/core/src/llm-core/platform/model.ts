import { Tiktoken } from 'js-tiktoken'
import {
    BaseChatModel,
    BaseChatModelCallOptions
} from 'langchain/chat_models/base'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from './api'
import { CallbackManagerForLLMRun } from 'langchain/callbacks'
import {
    BaseMessage,
    ChatGeneration,
    ChatGenerationChunk,
    ChatResult
} from 'langchain/schema'
import { encodingForModel } from '../utils/tiktoken'
import {
    getModelContextSize,
    getModelNameForTiktoken,
    messageTypeToOpenAIRole
} from '../utils/count_tokens'
import { createLogger } from '../../utils/logger'
import { StructuredTool } from 'langchain/tools'
import { Embeddings, EmbeddingsParams } from 'langchain/embeddings/base'
import { chunkArray } from '../utils/chunk'
import { sleep } from 'koishi'
import { ChatHubError, ChatHubErrorCode } from '../../utils/error'

const logger = createLogger()

export interface ChatHubModelCallOptions extends BaseChatModelCallOptions {
    model?: string

    /** Sampling temperature to use */
    temperature?: number

    /**
     * Maximum number of tokens to generate in the completion. -1 returns as many
     * tokens as possible given the prompt and the model's maximum context size.
     */
    maxTokens?: number

    /** Total probability mass of tokens to consider at each step */
    topP?: number

    /** Penalizes repeated tokens according to frequency */
    frequencyPenalty?: number

    /** Penalizes repeated tokens */
    presencePenalty?: number

    /** Number of completions to generate for each prompt */
    n?: number

    /** Dictionary used to adjust the probability of specific tokens being generated */
    logitBias?: Record<string, number>

    id?: string

    stream?: boolean

    tools?: StructuredTool[]
}

export interface ChatHubModelInput extends ChatHubModelCallOptions {
    llmType?: string

    modelMaxContextSize?: number

    requester: ModelRequester

    maxConcurrency?: number

    maxRetries?: number
}

export class ChatHubChatModel extends BaseChatModel<ChatHubModelCallOptions> {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    protected __encoding: Tiktoken

    private _requester: ModelRequester
    private _modelName: string
    private _maxModelContextSize: number

    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_serializable = false

    constructor(private _options: ChatHubModelInput) {
        super(_options)
        this._requester = _options.requester
        this._modelName = _options.model
        this._maxModelContextSize = _options.modelMaxContextSize
    }

    get callKeys(): (keyof ChatHubModelCallOptions)[] {
        return [
            ...(super.callKeys as (keyof ChatHubModelCallOptions)[]),
            'model',
            'temperature',
            'maxTokens',
            'topP',
            'frequencyPenalty',
            'presencePenalty',
            'n',
            'logitBias',
            'id',
            'stream',
            'tools'
        ]
    }

    /**
     * Get the parameters used to invoke the model
     */
    invocationParams(
        options?: this['ParsedCallOptions']
    ): ChatHubModelCallOptions {
        let maxTokens = options?.maxTokens ?? this._options.maxTokens

        if (maxTokens > this._maxModelContextSize || maxTokens < 0) {
            maxTokens = this._maxModelContextSize
        } else if (maxTokens === 0) {
            maxTokens = this._maxModelContextSize / 2
        }

        return {
            model: options?.model ?? this._options.model,
            temperature: options?.temperature ?? this._options.temperature,
            topP: options?.topP ?? this._options.topP,
            frequencyPenalty:
                options?.frequencyPenalty ?? this._options.frequencyPenalty,
            presencePenalty:
                options?.presencePenalty ?? this._options.presencePenalty,
            n: options?.n ?? this._options.n,
            logitBias: options?.logitBias ?? this._options.logitBias,
            maxTokens: maxTokens === -1 ? undefined : maxTokens,
            stop: options?.stop ?? this._options.stop,
            stream: options?.stream ?? this._options.stream,
            tools: options?.tools ?? this._options.tools,
            id: options?.id ?? this._options.id,
            timeout: options?.timeout ?? this._options.timeout
        }
    }

    async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun
    ): AsyncGenerator<ChatGenerationChunk> {
        const stream = await this._createStreamWithRetry({
            ...options,
            input: messages
        })

        for await (const chunk of stream) {
            yield chunk
            if (chunk.message?.additional_kwargs?.function_call == null) {
                // eslint-disable-next-line no-void
                void runManager?.handleLLMNewToken(chunk.text ?? '')
            }
        }
    }

    async _generate(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun
    ): Promise<ChatResult> {
        // crop the messages according to the model's max context size
        messages = await this.cropMessages(messages)

        const params = this.invocationParams(options)

        // fallback to max
        if (
            params.maxTokens != null &&
            params.maxTokens >= getModelContextSize(params.model)
        ) {
            params.maxTokens = undefined
        }

        const response = await this._generateWithRetry(
            messages,
            params,
            runManager
        )

        return {
            generations: [response]
        }
    }

    private _generateWithRetry(
        messages: BaseMessage[],
        options: ChatHubModelCallOptions,
        runManager?: CallbackManagerForLLMRun
    ): Promise<ChatGeneration> {
        const generateWithRetry = async () => {
            let response: ChatGeneration

            if (options.stream) {
                const stream = this._streamResponseChunks(
                    messages,
                    options,
                    runManager
                )
                for await (const chunk of stream) {
                    response = chunk
                }
            } else {
                response = await this._completionWithRetry({
                    ...options,
                    input: messages
                })
            }

            return response
        }

        return this.caller.call(generateWithRetry)
    }

    private async _withTimeout<T>(
        func: () => Promise<T>,
        timeout: number
    ): Promise<T> {
        // eslint-disable-next-line no-async-promise-executor
        return new Promise<T>(async (resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new ChatHubError(ChatHubErrorCode.API_REQUEST_TIMEOUT))
            }, timeout)

            let result: T

            try {
                result = await func()
                clearTimeout(timeoutId)
            } catch (error) {
                clearTimeout(timeoutId)
                reject(error)
                return
            }

            clearTimeout(timeoutId)

            resolve(result)
        })
    }

    /**
     ** Creates a streaming request with retry.
     * @param request The parameters for creating a completion.
     ** @returns A streaming request.
     */
    private _createStreamWithRetry(params: ModelRequestParams) {
        const makeCompletionRequest = async () => {
            try {
                const result = await this._withTimeout(
                    async () => this._requester.completionStream(params),
                    params.timeout
                )
                return result
            } catch (e) {
                await sleep(2000)
                throw e
            }
        }
        return this.caller.call(makeCompletionRequest)
    }

    /** @ignore */
    private _completionWithRetry(params: ModelRequestParams) {
        const makeCompletionRequest = async () => {
            const result = await this._withTimeout(
                async () => await this._requester.completion(params),
                params.timeout
            )
            return result
        }

        return this.caller.call(makeCompletionRequest)
    }

    async cropMessages(
        messages: BaseMessage[],
        systemMessageLength: number = 1
    ): Promise<BaseMessage[]> {
        messages = messages.concat()
        const result: BaseMessage[] = []

        let totalTokens = 0

        // always add the first message
        const systemMessages: BaseMessage[] = []

        let index = 0

        if (messages.length < systemMessageLength) {
            throw new ChatHubError(
                ChatHubErrorCode.UNKNOWN_ERROR,
                new Error('Message length is less than system message length')
            )
        }

        while (index < systemMessageLength) {
            const message = messages.shift()
            systemMessages.push(message)
            totalTokens += await this._countMessageTokens(message)
            index++
        }

        for (const message of messages.reverse()) {
            const messageTokens = await this._countMessageTokens(message)

            if (totalTokens + messageTokens > this.getModelMaxContextSize()) {
                break
            }

            totalTokens += messageTokens
            result.unshift(message)
        }

        for (const message of systemMessages.reverse()) {
            result.unshift(message)
        }

        return result
    }

    private async _countMessageTokens(message: BaseMessage) {
        let result =
            (await this.getNumTokens(message.content)) +
            (await this.getNumTokens(
                messageTypeToOpenAIRole(message._getType())
            ))

        if (message.name) {
            result += await this.getNumTokens(message.name)
        }

        return result
    }

    async clearContext(): Promise<void> {
        await this._requester.dispose()
    }

    getModelMaxContextSize() {
        if (this._maxModelContextSize != null) {
            return this._maxModelContextSize
        }
        const modelName = this._modelName ?? 'gpt2'
        return getModelContextSize(modelName)
    }

    async getNumTokens(text: string) {
        // fallback to approximate calculation if tiktoken is not available
        let numTokens = Math.ceil(text.length / 4)

        if (!this.__encoding) {
            try {
                this.__encoding = await encodingForModel(
                    'modelName' in this
                        ? getModelNameForTiktoken(this.modelName as string)
                        : 'gpt2'
                )
            } catch (error) {
                logger.warn(
                    'Failed to calculate number of tokens, falling back to approximate count',
                    error
                )
            }
        }

        if (this.__encoding) {
            numTokens = this.__encoding.encode(text).length
        }
        return numTokens
    }

    _llmType(): string {
        return this._options?.llmType ?? 'openai'
    }

    get modelName() {
        return this._modelName
    }

    _modelType(): string {
        return 'base_chat_model'
    }

    /** @ignore */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _combineLLMOutput(...llmOutputs: any[]): any {}
}

export interface ChatHubBaseEmbeddingsParams extends EmbeddingsParams {
    /**
     * Timeout to use when making requests.
     */
    timeout?: number

    /**
     * The maximum number of documents to embed in a single request. This is
     * limited by the OpenAI API to a maximum of 2048.
     */
    batchSize?: number

    /**
     * Whether to strip new lines from the input text. This is recommended by
     * OpenAI, but may not be suitable for all use cases.
     */
    stripNewLines?: boolean

    maxRetries?: number

    client: EmbeddingsRequester

    model?: string
}

export abstract class ChatHubBaseEmbeddings extends Embeddings {}

export class ChatHubEmbeddings extends ChatHubBaseEmbeddings {
    modelName = 'text-embedding-ada-002'

    batchSize = 512

    stripNewLines = true

    timeout?: number

    private _client: EmbeddingsRequester

    constructor(fields?: ChatHubBaseEmbeddingsParams) {
        super(fields)

        this.batchSize = fields?.batchSize ?? this.batchSize
        this.stripNewLines = fields?.stripNewLines ?? this.stripNewLines
        this.timeout = fields?.timeout ?? 1000 * 60
        this.modelName = fields?.model ?? this.modelName

        this._client = fields?.client
    }

    async embedDocuments(texts: string[]): Promise<number[][]> {
        const subPrompts = chunkArray(
            this.stripNewLines
                ? texts.map((t) => t.replaceAll('\n', ' '))
                : texts,
            this.batchSize
        )

        const embeddings: number[][] = []

        for (let i = 0; i < subPrompts.length; i += 1) {
            const input = subPrompts[i]
            const data = await this._embeddingWithRetry({
                model: this.modelName,
                input
            })
            for (let j = 0; j < input.length; j += 1) {
                embeddings.push(data[j] as number[])
            }
        }

        return embeddings
    }

    async embedQuery(text: string): Promise<number[]> {
        const data = await this._embeddingWithRetry({
            model: this.modelName,
            input: this.stripNewLines ? text.replaceAll('\n', ' ') : text
        })
        if (data[0] instanceof Array) {
            return data[0]
        }
        return data as number[]
    }

    private _embeddingWithRetry(request: EmbeddingsRequestParams) {
        request.timeout = request.timeout ?? this.timeout
        return this.caller.call(
            async (request: EmbeddingsRequestParams) =>
                // eslint-disable-next-line no-async-promise-executor
                new Promise<number[] | number[][]>(async (resolve, reject) => {
                    const timeout = setTimeout(
                        () => {
                            reject(
                                Error(
                                    `timeout when calling ${this.modelName} embeddings`
                                )
                            )
                        },
                        this.timeout ?? 1000 * 30
                    )

                    let data: number[] | number[][]

                    try {
                        data = await this._client.embeddings(request)
                    } catch (e) {
                        if (e instanceof ChatHubError) {
                            reject(e)
                        } else {
                            throw new ChatHubError(
                                ChatHubErrorCode.API_REQUEST_FAILED,
                                e
                            )
                        }
                    }

                    clearTimeout(timeout)

                    if (data) {
                        resolve(data)
                        return
                    }

                    reject(
                        Error(
                            `error when calling ${this.modelName} embeddings, Result: ` +
                                JSON.stringify(data)
                        )
                    )
                }),
            request
        )
    }
}
