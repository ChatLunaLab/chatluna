import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager'
import { Embeddings, EmbeddingsParams } from '@langchain/core/embeddings'
import {
    BaseChatModel,
    BaseChatModelCallOptions
} from '@langchain/core/language_models/chat_models'
import { AIMessageChunk, BaseMessage } from '@langchain/core/messages'
import {
    ChatGeneration,
    ChatGenerationChunk,
    ChatResult
} from '@langchain/core/outputs'
import { StructuredTool } from '@langchain/core/tools'
import { Tiktoken } from 'js-tiktoken'
import { sleep } from 'koishi'
import {
    EmbeddingsRequester,
    EmbeddingsRequestParams,
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
    ModelInfo,
    TokenUsageTracker
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    getModelContextSize,
    getModelNameForTiktoken,
    messageTypeToOpenAIRole
} from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { chunkArray } from 'koishi-plugin-chatluna/llm-core/utils/chunk'
import { encodingForModel } from '../utils/tiktoken'
import { formatFunctionDefinitions } from '../utils/function_def'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { logger } from 'koishi-plugin-chatluna'

export interface ChatLunaModelCallOptions extends BaseChatModelCallOptions {
    model?: string

    /** Sampling temperature to use */
    temperature?: number

    /**
     * Maximum number of tokens to generate in the completion. -1 returns as many
     * tokens as possible given the prompt and the model's maximum context size.
     */
    maxTokens?: number

    /**
     * Maximum number of tokens to crop the context to.
     * If not set, the model's maximum context size will be used.
     */
    maxTokenLimit?: number

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

    tool_choice?: string

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables?: Record<string, any>

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables_hide?: Record<string, any>
}

export interface ChatLunaModelInput extends ChatLunaModelCallOptions {
    llmType?: string

    modelMaxContextSize?: number

    modelInfo: ModelInfo

    requester: ModelRequester

    maxConcurrency?: number

    maxRetries?: number

    isThinkModel?: boolean
}

export class ChatLunaChatModel extends BaseChatModel<ChatLunaModelCallOptions> {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    protected __encoding: Tiktoken

    private _requester: ModelRequester
    private _modelName: string
    private _maxModelContextSize: number
    private _modelInfo: ModelInfo
    private _isThinkModel: boolean

    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_serializable = false

    constructor(private _options: ChatLunaModelInput) {
        super(_options)
        this._requester = _options.requester
        this._modelName = _options.model ?? _options.modelInfo.name
        this._maxModelContextSize = _options.modelMaxContextSize
        this._modelInfo = _options.modelInfo
        this._isThinkModel = _options.isThinkModel ?? false
    }

    get callKeys(): (keyof ChatLunaModelCallOptions)[] {
        return [
            ...(super.callKeys as (keyof ChatLunaModelCallOptions)[]),
            'model',
            'temperature',
            'maxTokens',
            'maxTokenLimit',
            'topP',
            'frequencyPenalty',
            'presencePenalty',
            'n',
            'logitBias',
            'id',
            'variables_hide',
            'stream',
            'tools'
        ]
    }

    /**
     * Get the parameters used to invoke the model
     */
    invocationParams(
        options?: this['ParsedCallOptions']
    ): ChatLunaModelCallOptions {
        let maxTokenLimit =
            options?.maxTokenLimit ?? this._options.maxTokenLimit

        if (maxTokenLimit < 0 || maxTokenLimit === 0) {
            maxTokenLimit = this._maxModelContextSize / 2
        }

        const modelName = options?.model ?? this._modelName

        // fallback to max
        if (
            maxTokenLimit != null &&
            maxTokenLimit >= this.getModelMaxContextSize()
        ) {
            maxTokenLimit = this.getModelMaxContextSize()
        }

        return {
            model: modelName,
            temperature: options?.temperature ?? this._options.temperature,
            topP: options?.topP ?? this._options.topP,
            frequencyPenalty:
                options?.frequencyPenalty ?? this._options.frequencyPenalty,
            presencePenalty:
                options?.presencePenalty ?? this._options.presencePenalty,
            n: options?.n ?? this._options.n,
            logitBias: options?.logitBias ?? this._options.logitBias,
            maxTokens: options?.maxTokens ?? this._options.maxTokens,
            maxTokenLimit,
            variables: options?.['variables_hide'] ?? {},
            stop: options?.stop ?? this._options.stop,
            stream: options?.stream ?? this._options.stream,
            tools: options?.tools ?? this._options.tools,
            id: options?.id ?? this._options.id,
            signal: options?.signal ?? this._options.signal,
            timeout: options?.timeout ?? this._options.timeout
        }
    }

    async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun
    ): AsyncGenerator<ChatGenerationChunk> {
        const withTool = (options.tools?.length ?? 0) > 0

        if (withTool) {
            ;[messages] = await this.cropMessages(messages, options['tools'])
        }

        const maxRetries = Math.max(1, this._options.maxRetries ?? 1)
        const streamParams = {
            ...this.invocationParams(options),
            input: messages
        }

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const latestTokenUsage = this._createTokenUsageTracker()
            let stream: AsyncGenerator<ChatGenerationChunk> | null = null
            let hasChunk = false
            let isToolCallMessage = false

            try {
                stream = await this._createStreamWithRetry(streamParams)

                for await (const chunk of stream) {
                    isToolCallMessage = this._handleStreamChunk(
                        chunk,
                        runManager,
                        latestTokenUsage
                    )
                    hasChunk = true
                    yield chunk
                }

                this._ensureChunksReceived(hasChunk)
                this._finalizeStream(
                    isToolCallMessage,
                    latestTokenUsage,
                    runManager
                )
                return
            } catch (error) {
                await this._closeStream(stream)

                if (
                    this._shouldRethrowStreamError(
                        error,
                        hasChunk,
                        attempt,
                        maxRetries
                    )
                ) {
                    throw error
                }

                await sleep(2000)
            }
        }
    }

    private _createTokenUsageTracker(): TokenUsageTracker {
        return {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0
        }
    }

    private _handleStreamChunk(
        chunk: ChatGenerationChunk,
        runManager: CallbackManagerForLLMRun | undefined,
        latestTokenUsage: TokenUsageTracker
    ): boolean {
        const chunkText = chunk.text ?? ''

        if (chunkText) {
            // eslint-disable-next-line no-void
            void runManager?.handleLLMNewToken(chunkText)
        }

        const message = chunk.message as AIMessageChunk | undefined
        const isToolCallMessage = this._isToolCallMessage(message)

        if (isToolCallMessage) {
            // eslint-disable-next-line no-void
            void runManager?.handleCustomEvent('LLMNewChunk', message)
        }

        this._updateTokenUsageFromChunk(chunk, latestTokenUsage)

        return isToolCallMessage
    }

    private _isToolCallMessage(message?: AIMessageChunk): boolean {
        return (
            (message?.tool_calls?.length ?? 0) === 0 &&
            (message?.tool_call_chunks?.length ?? 0) === 0 &&
            (message?.invalid_tool_calls?.length ?? 0) === 0
        )
    }

    private _updateTokenUsageFromChunk(
        chunk: ChatGenerationChunk,
        latestTokenUsage: TokenUsageTracker
    ) {
        const tokenUsage = chunk.message.response_metadata?.['tokenUsage']

        if (!tokenUsage) {
            return
        }

        latestTokenUsage.promptTokens = tokenUsage['promptTokens']
        latestTokenUsage.completionTokens = tokenUsage['completionTokens']
        latestTokenUsage.totalTokens = tokenUsage['totalTokens']
    }

    private _ensureChunksReceived(hasChunk: boolean) {
        if (hasChunk) {
            return
        }

        throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED)
    }

    private _finalizeStream(
        isToolCallMessage: boolean,
        latestTokenUsage: TokenUsageTracker,
        runManager?: CallbackManagerForLLMRun
    ) {
        if (isToolCallMessage) {
            // eslint-disable-next-line no-void
            void runManager?.handleCustomEvent('LLMNewChunk', undefined)
        }

        if (latestTokenUsage.totalTokens <= 0) {
            return
        }

        logger.debug(
            'Token usage from API: Prompt Token = %d, Completion Token = %d, Total Token = %d',
            latestTokenUsage.promptTokens,
            latestTokenUsage.completionTokens,
            latestTokenUsage.totalTokens
        )
    }

    private async _closeStream(
        stream: AsyncGenerator<ChatGenerationChunk> | null
    ) {
        if (stream?.return == null) {
            return
        }

        try {
            await stream.return(undefined)
        } catch (error) {
            logger.debug(
                'Failed to close stream on retry: %s',
                (error as Error)?.message
            )
        }
    }

    private _shouldRethrowStreamError(
        error: unknown,
        hasChunk: boolean,
        attempt: number,
        maxRetries: number
    ): boolean {
        return (
            this._isAbortError(error) || hasChunk || attempt === maxRetries - 1
        )
    }

    private _isAbortError(error: unknown): boolean {
        if (error instanceof ChatLunaError) {
            return error.errorCode === ChatLunaErrorCode.ABORTED
        }

        return (error as Error)?.name === 'AbortError'
    }

    async _generate(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun
    ): Promise<ChatResult> {
        let promptTokens: number
        ;[messages, promptTokens] = await this.cropMessages(
            messages,
            options['tools']
        )

        const response = await this._generateWithRetry(
            messages,
            options,
            runManager
        )

        if (response == null) {
            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED)
        }

        response.message.response_metadata =
            response.message.response_metadata ?? {}

        if (!response.message.response_metadata.tokenUsage) {
            const completionTokens = await this.countMessageTokens(
                response.message
            )
            response.message.response_metadata.tokenUsage = {
                completionTokens,
                promptTokens,
                totalTokens: completionTokens + promptTokens
            }
        } else if (options.stream !== true) {
            const tokenUsage = response.message.response_metadata['tokenUsage']
            if (tokenUsage) {
                logger.debug(
                    'Token usage from API: Prompt Token = %d, Completion Token = %d, Total Token = %d',
                    tokenUsage.promptTokens,
                    tokenUsage.completionTokens,
                    tokenUsage.totalTokens
                )
            }
        }

        return {
            generations: [response],
            llmOutput: response.generationInfo
        }
    }

    private _generateWithRetry(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
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
                let responseChunk: ChatGenerationChunk
                for await (const chunk of stream) {
                    responseChunk =
                        responseChunk != null
                            ? responseChunk.concat(chunk)
                            : chunk
                }

                response = responseChunk
            } else {
                response = await this._completion({
                    ...this.invocationParams(options),
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
        let timeoutError: Error | null = null

        try {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_REQUEST_TIMEOUT,
                null,
                true
            )
        } catch (e) {
            timeoutError = e
        }

        let timeoutId: NodeJS.Timeout

        // eslint-disable-next-line promise/param-names
        const timeoutPromise = new Promise<T>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(timeoutError)
            }, timeout)
        })

        try {
            return await Promise.race([func(), timeoutPromise])
        } finally {
            clearTimeout(timeoutId)
        }
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
    private async _completion(params: ModelRequestParams) {
        try {
            const result = await this._withTimeout(
                () => this._requester.completion(params),
                params.timeout
            )
            return result
        } catch (e) {
            await sleep(2000)
            throw e
        }
    }

    async cropMessages(
        messages: BaseMessage[],
        tools?: StructuredTool[],
        systemMessageLength: number = 1
    ): Promise<[BaseMessage[], number]> {
        messages = messages.concat([])

        const maxTokenLimit = this.invocationParams().maxTokenLimit

        let totalTokens = 0

        // If there are functions, add the function definitions as they count towards token usage
        if (tools) {
            const promptDefinitions = formatFunctionDefinitions(tools)
            totalTokens += await this.getNumTokens(promptDefinitions)
            totalTokens += 9 // Add nine per completion
        }

        // If there's a system message _and_ functions are present, subtract four tokens. I assume this is because
        // functions typically add a system message, but reuse the first one if it's already there. This offsets
        // the extra 9 tokens added by the function definitions.
        if (tools && messages.find((m) => m.getType() === 'system')) {
            totalTokens -= 4
        }

        // always add the first message
        const systemMessages: BaseMessage[] = []

        let index = 0

        if (messages.length < systemMessageLength) {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error('Message length is less than system message length')
            )
        }

        while (index < systemMessageLength) {
            const message = messages.shift()
            systemMessages.push(message)
            totalTokens += await this.countMessageTokens(message)
            index++
        }

        const buildConversationRounds = (items: BaseMessage[]) => {
            const rounds: BaseMessage[][] = []
            let current: BaseMessage[] = []

            for (const message of items) {
                if (message.getType() === 'human') {
                    if (current.length > 0) {
                        rounds.push(current)
                    }
                    current = [message]
                } else {
                    if (current.length === 0) {
                        current = [message]
                    } else {
                        current.push(message)
                    }
                }
            }

            if (current.length > 0) {
                rounds.push(current)
            }

            return rounds
        }

        const countMessagesTokens = async (items: BaseMessage[]) => {
            let tokens = 0
            for (const item of items) {
                tokens += await this.countMessageTokens(item)
            }
            return tokens
        }

        const conversationRounds = buildConversationRounds(messages)
        const selectedRounds: BaseMessage[][] = []
        let truncated = false

        for (let i = conversationRounds.length - 1; i >= 0; i--) {
            const round = conversationRounds[i]
            const roundTokens = await countMessagesTokens(round)
            const exceedsLimit =
                maxTokenLimit != null && maxTokenLimit > 0
                    ? totalTokens + roundTokens > maxTokenLimit
                    : false

            if (exceedsLimit && selectedRounds.length > 0) {
                truncated = true
                break
            }

            totalTokens += roundTokens
            selectedRounds.unshift(round)

            if (exceedsLimit) {
                truncated = true
                break
            }
        }

        if (conversationRounds.length > 0 && selectedRounds.length === 0) {
            const round = conversationRounds[conversationRounds.length - 1]
            totalTokens += await countMessagesTokens(round)
            selectedRounds.unshift(round)
            truncated = maxTokenLimit != null && maxTokenLimit > 0
        }

        const flattenedRounds = selectedRounds.reduce<BaseMessage[]>(
            (acc, round) => acc.concat(round),
            []
        )

        const result = systemMessages.concat(flattenedRounds)

        if (truncated) {
            logger?.warn(
                `Message length exceeds token limit. ${totalTokens} > ${maxTokenLimit}. Try increasing the adapter token limit or reducing the message length.`
            )
        }

        // Add session-level priming token (every reply is primed with <|start|>assistant<|message|>)
        totalTokens += 3

        return [result, totalTokens]
    }

    public async countMessageTokens(message: BaseMessage) {
        let totalCount = 0
        let tokensPerMessage = 0
        let tokensPerName = 0

        // From: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_format_inputs_to_ChatGPT_models.ipynb
        if (this.modelName === 'gpt-3.5-turbo-0301') {
            tokensPerMessage = 4
            tokensPerName = -1
        } else {
            tokensPerMessage = 3
            tokensPerName = 1
        }

        const textCount = await this.getNumTokens(
            getMessageContent(message.content) ?? ''
        )

        const roleCount = await this.getNumTokens(
            messageTypeToOpenAIRole(message.getType())
        )
        const nameCount =
            message.name !== undefined
                ? tokensPerName + (await this.getNumTokens(message.name))
                : 0
        let count = textCount + tokensPerMessage + roleCount + nameCount

        // From: https://github.com/hmarr/openai-chat-tokens/blob/main/src/index.ts messageTokenEstimate
        const openAIMessage = message
        if (openAIMessage.getType() === 'function') {
            count -= 2
        }
        if (openAIMessage.additional_kwargs?.function_call) {
            count += 3
        }
        if (openAIMessage?.additional_kwargs.function_call?.name) {
            count += await this.getNumTokens(
                openAIMessage.additional_kwargs.function_call?.name
            )
        }
        if (
            openAIMessage.additional_kwargs.function_call?.arguments &&
            typeof openAIMessage.additional_kwargs.function_call.arguments ===
                'string'
        ) {
            count += await this.getNumTokens(
                // Remove newlines and spaces
                JSON.stringify(
                    JSON.parse(
                        openAIMessage.additional_kwargs.function_call?.arguments
                    )
                )
            )
        }

        totalCount += count

        totalCount += 3 // every reply is primed with <|start|>assistant<|message|>

        return totalCount
    }

    async clearContext(id: string): Promise<void> {
        await this._requester.dispose(this.modelName, id)
    }

    getModelMaxContextSize(modelName: string = this._modelName) {
        if (this._maxModelContextSize != null) {
            return this._maxModelContextSize
        }
        return getModelContextSize(modelName)
    }

    async getNumTokens(text: string, modelName: string = this.modelName) {
        // fallback to approximate calculation if tiktoken is not available
        let numTokens = Math.ceil(text.length / 4)

        if (!this.__encoding) {
            try {
                this.__encoding = await encodingForModel(
                    'modelName' in this
                        ? getModelNameForTiktoken(modelName)
                        : 'gpt2'
                )
            } catch (error) {
                /* logger.warn(
                    'Failed to calculate number of tokens, falling back to approximate count',
                    error
                ) */
            }
        }

        if (this.__encoding) {
            numTokens = this.__encoding.encode(text)?.length ?? numTokens
        }
        return numTokens
    }

    _llmType(): string {
        return this._options?.llmType ?? 'openai'
    }

    get modelName() {
        return this._modelName
    }

    get modelInfo() {
        return this._modelInfo
    }

    get isThinkModel() {
        return this._isThinkModel
    }

    _modelType(): string {
        return 'base_chat_model'
    }

    /** @ignore */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _combineLLMOutput(...llmOutputs: any[]): any {}
}

export interface ChatLunaBaseEmbeddingsParams extends EmbeddingsParams {
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

export abstract class ChatLunaBaseEmbeddings extends Embeddings {}

export class ChatLunaEmbeddings extends ChatLunaBaseEmbeddings {
    modelName = 'text-embedding-ada-002'

    batchSize = 30

    stripNewLines = true

    timeout?: number

    private _client: EmbeddingsRequester

    constructor(fields?: ChatLunaBaseEmbeddingsParams) {
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

    private async _embeddingWithRetry(request: EmbeddingsRequestParams) {
        request.timeout = request.timeout ?? this.timeout

        let timeoutError: Error | null = null

        try {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_REQUEST_TIMEOUT,
                new Error(`timeout when calling ${this.modelName} embeddings`),
                true
            )
        } catch (e) {
            timeoutError = e
        }

        const makeRequest = async () => {
            let timeoutId: NodeJS.Timeout

            const timeoutPromise = new Promise<number[] | number[][]>(
                // eslint-disable-next-line promise/param-names
                (_, reject) => {
                    timeoutId = setTimeout(() => {
                        reject(timeoutError)
                    }, request.timeout)
                }
            )

            try {
                const data = await Promise.race([
                    this._client.embeddings(request),
                    timeoutPromise
                ])
                return data
            } catch (e) {
                if (e instanceof ChatLunaError) {
                    throw e
                }
                throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
            } finally {
                clearTimeout(timeoutId)
            }
        }

        try {
            return await this.caller.call(makeRequest)
        } catch (e) {
            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, e)
        }
    }
}
