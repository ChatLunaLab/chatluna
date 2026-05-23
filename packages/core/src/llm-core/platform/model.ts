import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager'
import { Embeddings, EmbeddingsParams } from '@langchain/core/embeddings'
import {
    BaseChatModel,
    BaseChatModelCallOptions
} from '@langchain/core/language_models/chat_models'
import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    type UsageMetadata
} from '@langchain/core/messages'
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
import type { FileHandlingConfig } from 'koishi-plugin-chatluna/llm-core/platform/client'
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
import { isChatLunaUserMessage } from 'koishi-plugin-chatluna/utils/langchain'
import { logger } from 'koishi-plugin-chatluna'
import type {
    ModelUsageContext,
    ModelUsageReporter
} from 'koishi-plugin-chatluna/llm-core/platform/usage'
import { estimateTextTokens } from 'koishi-plugin-chatluna/llm-core/platform/usage'

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

    /**
     * Override request params for this request only.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    overrideRequestParams?: Record<string, any>
}

export interface ChatLunaModelInput extends ChatLunaModelCallOptions {
    llmType?: string

    modelMaxContextSize?: number

    modelInfo: ModelInfo

    requester: ModelRequester

    maxConcurrency?: number

    maxRetries?: number

    isThinkModel?: boolean

    fileHandlingConfig?: FileHandlingConfig

    usageReporter?: ModelUsageReporter
}

export class ChatLunaChatModel extends BaseChatModel<ChatLunaModelCallOptions> {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    protected __encoding: Tiktoken

    private _requester: ModelRequester
    private _modelName: string
    private _maxModelContextSize: number
    private _modelInfo: ModelInfo
    private _isThinkModel: boolean
    private _fileHandlingConfig?: FileHandlingConfig
    private _report?: ModelUsageReporter

    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_serializable = false

    constructor(private _options: ChatLunaModelInput) {
        super(_options)
        this._requester = _options.requester
        this._modelName = _options.model ?? _options.modelInfo.name
        this._maxModelContextSize = _options.modelMaxContextSize
        this._modelInfo = _options.modelInfo
        this._isThinkModel = _options.isThinkModel ?? false
        this._fileHandlingConfig = _options.fileHandlingConfig
        this._report = _options.usageReporter
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
            'overrideRequestParams',
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

        // Preserve the conversation id when the executor provides it.
        let id = options?.id ?? this._options.id
        if (!id) {
            id = options?.variables_hide?.['built']?.['conversationId']
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
            variables:
                options?.['variables_hide'] ?? options?.['variables'] ?? {},
            overrideRequestParams:
                options?.overrideRequestParams ??
                this._options.overrideRequestParams ??
                {},
            stop: options?.stop ?? this._options.stop,
            stream: options?.stream ?? this._options.stream,
            tools: options?.tools ?? this._options.tools,
            id,
            signal: options?.signal ?? this._options.signal,
            timeout: options?.timeout ?? this._options.timeout
        }
    }

    async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun,
        reportUsage = true
    ): AsyncGenerator<ChatGenerationChunk> {
        const maxRetries = Math.max(1, this._options.maxRetries ?? 1)
        let promptTokens = 0

        if (reportUsage) {
            ;[messages, promptTokens] = await this.cropMessages(
                messages,
                options['tools']
            )
        }

        const streamParams = {
            ...this.invocationParams(options),
            input: messages
        }

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const latestTokenUsage = this._createTokenUsageTracker()
            let stream: AsyncGenerator<ChatGenerationChunk> | null = null
            let hasChunk = false
            let hasResponse = false
            let hasToolCallChunk = false
            let response: ChatGenerationChunk | undefined

            try {
                stream = await this._createStream(streamParams)

                for await (const chunk of stream) {
                    const hasTool = this._handleStreamChunk(
                        chunk,
                        runManager,
                        latestTokenUsage
                    )
                    hasToolCallChunk = hasTool || hasToolCallChunk
                    hasChunk = true
                    hasResponse =
                        hasResponse ||
                        this._hasResponse(
                            chunk.message as AIMessage | AIMessageChunk
                        )
                    response = response != null ? response.concat(chunk) : chunk
                    yield chunk
                }

                if (!hasResponse) {
                    throw new ChatLunaError(
                        ChatLunaErrorCode.API_REQUEST_FAILED
                    )
                }

                this._finalizeStream(
                    hasToolCallChunk,
                    latestTokenUsage,
                    runManager
                )
                if (reportUsage) {
                    await this._reportStreamUsage(
                        latestTokenUsage,
                        promptTokens,
                        response,
                        options
                    )
                }
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
                    if (hasChunk) {
                        logger.debug(
                            'Stream failed after yielding chunks, cannot retry'
                        )
                    }
                    if (reportUsage) {
                        await this._reportFailedUsage(
                            options,
                            promptTokens,
                            latestTokenUsage.output_tokens
                        )
                    }
                    throw error
                }

                logger.debug(
                    `Stream failed before first chunk (attempt ${attempt + 1}/${maxRetries}), retrying...`
                )
                await sleep(2000 * 2 ** attempt)
            }
        }
    }

    private _createTokenUsageTracker(): TokenUsageTracker {
        return {
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0
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
        const hasToolCallChunk = this._hasToolCallChunk(message)

        if (hasToolCallChunk) {
            // eslint-disable-next-line no-void
            void runManager?.handleCustomEvent('LLMNewChunk', message)
        }

        this._updateTokenUsageFromChunk(chunk, latestTokenUsage)

        return hasToolCallChunk
    }

    private _hasToolCallChunk(message?: AIMessage | AIMessageChunk): boolean {
        return (
            (message?.tool_calls?.length ?? 0) > 0 ||
            ((message as AIMessageChunk | undefined)?.tool_call_chunks
                ?.length ?? 0) > 0 ||
            (message?.invalid_tool_calls?.length ?? 0) > 0
        )
    }

    private _hasResponse(message?: AIMessage | AIMessageChunk): boolean {
        const content = message?.content

        return (
            (typeof content === 'string'
                ? content.trim().length > 0
                : Array.isArray(content) && content.length > 0) ||
            this._hasToolCallChunk(message) ||
            ((message?.additional_kwargs?.tool_calls as unknown[] | undefined)
                ?.length ?? 0) > 0 ||
            message?.additional_kwargs?.function_call != null
        )
    }

    private _updateTokenUsageFromChunk(
        chunk: ChatGenerationChunk,
        latestTokenUsage: TokenUsageTracker
    ) {
        const usage = (chunk.message as AIMessageChunk).usage_metadata

        if (!usage?.total_tokens) {
            return
        }

        latestTokenUsage.input_tokens = usage.input_tokens
        latestTokenUsage.output_tokens = usage.output_tokens
        latestTokenUsage.total_tokens = usage.total_tokens
        latestTokenUsage.input_token_details = usage.input_token_details
        latestTokenUsage.output_token_details = usage.output_token_details
    }

    private _finalizeStream(
        hasToolCallChunk: boolean,
        latestTokenUsage: TokenUsageTracker,
        runManager?: CallbackManagerForLLMRun
    ) {
        if (hasToolCallChunk) {
            // eslint-disable-next-line no-void
            void runManager?.handleCustomEvent('LLMNewChunk', undefined)
        }

        if (latestTokenUsage.total_tokens <= 0) {
            return
        }

        logger.debug(formatUsageMetadata(latestTokenUsage))
    }

    private async _reportStreamUsage(
        usage: UsageMetadata,
        promptTokens: number,
        response: ChatGenerationChunk | undefined,
        options: this['ParsedCallOptions']
    ) {
        if (usage.total_tokens > 0) {
            await this._reportUsage(usage, false, options)
            return
        }

        const outputTokens = response
            ? await this.countMessageTokens(response.message)
            : 0
        await this._reportUsage(
            {
                input_tokens: promptTokens,
                output_tokens: outputTokens,
                total_tokens: promptTokens + outputTokens
            },
            true,
            options
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

        let response: ChatGeneration
        try {
            response = await this._generateWithRetry(
                messages,
                options,
                runManager
            )
        } catch (e) {
            await this._reportFailedUsage(options, promptTokens)
            throw e
        }

        if (response == null) {
            await this._reportFailedUsage(options, promptTokens)
            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED)
        }

        const message = response.message as AIMessage | AIMessageChunk
        let usageMetadata = message.usage_metadata

        if (!usageMetadata?.total_tokens) {
            const metadata = message.response_metadata as
                | {
                      tokenUsage?: {
                          promptTokens?: number
                          completionTokens?: number
                          totalTokens?: number
                      }
                      usage?: {
                          prompt_tokens?: number
                          completion_tokens?: number
                          total_tokens?: number
                      }
                  }
                | undefined
            const tokenUsage = metadata?.tokenUsage
            const usage = metadata?.usage
            if (tokenUsage?.totalTokens != null) {
                usageMetadata = {
                    input_tokens: tokenUsage.promptTokens ?? 0,
                    output_tokens: tokenUsage.completionTokens ?? 0,
                    total_tokens: tokenUsage.totalTokens
                }
            } else if (usage?.total_tokens != null) {
                usageMetadata = {
                    input_tokens: usage.prompt_tokens ?? 0,
                    output_tokens: usage.completion_tokens ?? 0,
                    total_tokens: usage.total_tokens
                }
            }
        }

        const estimated = !usageMetadata?.total_tokens

        if (!usageMetadata?.total_tokens) {
            const completionTokens = await this.countMessageTokens(
                response.message
            )
            usageMetadata = {
                input_tokens: promptTokens,
                output_tokens: completionTokens,
                total_tokens: completionTokens + promptTokens
            }
        } else if (options.stream !== true) {
            logger.debug(formatUsageMetadata(usageMetadata))
        }

        if (response.message.getType() === 'ai') {
            ;(response.message as AIMessage | AIMessageChunk).usage_metadata =
                usageMetadata
        }

        response.generationInfo = {
            ...response.generationInfo,
            usage_metadata: usageMetadata
        }

        await this._reportUsage(usageMetadata, estimated, options)

        return {
            generations: [response],
            llmOutput: response.generationInfo
        }
    }

    private async _reportUsage(
        usage: UsageMetadata,
        estimated: boolean,
        options: this['ParsedCallOptions']
    ) {
        if (this._report == null) return

        try {
            await this._report({
                callType: 'llm',
                usageMetadata: usage,
                estimated,
                success: true,
                context: usageContextFromOptions(options)
            })
        } catch (e) {
            logger.warn('Failed to report LLM usage', e)
        }
    }

    private async _reportFailedUsage(
        options: this['ParsedCallOptions'],
        promptTokens = 0,
        outputTokens = 0
    ) {
        if (this._report == null) return

        try {
            await this._report({
                callType: 'llm',
                usageMetadata: {
                    input_tokens: promptTokens,
                    output_tokens: outputTokens,
                    total_tokens: promptTokens + outputTokens
                },
                estimated: promptTokens > 0 || outputTokens > 0,
                success: false,
                context: usageContextFromOptions(options)
            })
        } catch (e) {
            logger.warn('Failed to report LLM usage', e)
        }
    }

    private _generateWithRetry(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun
    ): Promise<ChatGeneration> {
        const maxRetries = Math.max(1, this._options.maxRetries ?? 1)

        const generateWithRetry = async () => {
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    let response: ChatGeneration

                    if (options.stream) {
                        const stream = this._streamResponseChunks(
                            messages,
                            options,
                            runManager,
                            false
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

                    if (
                        !this._hasResponse(
                            response.message as AIMessage | AIMessageChunk
                        )
                    ) {
                        throw new ChatLunaError(
                            ChatLunaErrorCode.API_REQUEST_FAILED
                        )
                    }

                    return response
                } catch (error) {
                    if (
                        options.stream ||
                        this._isAbortError(error) ||
                        attempt === maxRetries - 1
                    ) {
                        throw error
                    }

                    await sleep(2000 * 2 ** attempt)
                }
            }

            throw new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED)
        }

        return generateWithRetry()
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

    private _createStream(params: ModelRequestParams) {
        return this._withTimeout(
            async () => this._requester.completionStream(params),
            params.timeout
        )
    }

    /** @ignore */
    private async _completion(params: ModelRequestParams) {
        return this._withTimeout(
            () => this._requester.completion(params),
            params.timeout
        )
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
                const isStart =
                    isChatLunaUserMessage(message) ||
                    message.getType() === 'human'

                if (isStart) {
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

        const tokenCounter = (text: string) => this.getNumTokens(text)
        const countRoundTokens = async (items: BaseMessage[]) => {
            let tokens = 0
            for (const item of items) {
                tokens += await this.countMessageTokens(item)
            }
            return tokens
        }

        const conversationRounds = buildConversationRounds(messages)
        const selectedRounds: BaseMessage[][] = []
        let truncated = false

        // Find baseline: last AI message with usage_metadata in the conversation
        let baselineIdx = -1
        let baselineTokens = 0
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].getType() !== 'ai') continue
            const usage = (messages[i] as AIMessage).usage_metadata
            if (usage?.input_tokens > 0) {
                baselineIdx = i
                // input_tokens includes system messages we already counted
                baselineTokens = usage.input_tokens - totalTokens
                break
            }
        }

        if (baselineIdx >= 0 && maxTokenLimit != null && maxTokenLimit > 0) {
            // Find which round the baseline falls in
            let msgCount = 0
            let baselineRoundIdx = -1
            for (let r = 0; r < conversationRounds.length; r++) {
                msgCount += conversationRounds[r].length
                if (msgCount > baselineIdx) {
                    baselineRoundIdx = r
                    break
                }
            }
            if (baselineRoundIdx < 0) {
                baselineRoundIdx = conversationRounds.length - 1
            }

            // Iterate from end; when we reach baseline region, add all at once
            for (let i = conversationRounds.length - 1; i >= 0; i--) {
                if (i <= baselineRoundIdx && selectedRounds.length === 0) {
                    // Bulk add all rounds up to baseline
                    const exceedsLimit =
                        totalTokens + baselineTokens > maxTokenLimit

                    if (exceedsLimit && selectedRounds.length > 0) {
                        truncated = true
                        break
                    }

                    totalTokens += baselineTokens
                    for (let j = 0; j <= baselineRoundIdx; j++) {
                        selectedRounds.unshift(
                            conversationRounds[baselineRoundIdx - j]
                        )
                    }

                    if (exceedsLimit) {
                        truncated = true
                    }
                    break
                }

                const round = conversationRounds[i]
                const roundTokens = await countRoundTokens(round)
                const exceedsLimit =
                    totalTokens + roundTokens > maxTokenLimit

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
        } else {
            // No baseline or no limit, fallback to counting each round
            for (let i = conversationRounds.length - 1; i >= 0; i--) {
                const round = conversationRounds[i]
                const roundTokens = await countRoundTokens(round)
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
        }

        if (conversationRounds.length > 0 && selectedRounds.length === 0) {
            const round = conversationRounds[conversationRounds.length - 1]
            totalTokens += await countRoundTokens(round)
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
        let rawCount = 0
        for (const char of text) {
            rawCount += char.charCodeAt(0) <= 0x7f ? 0.25 : 2 / 3
        }
        let numTokens = Math.ceil(rawCount)

        if (
            ![
                'gpt-',
                'o1',
                'o3',
                'o4',
                'chatgpt-',
                'text-',
                'davinci',
                'babbage',
                'curie',
                'ada',
                'code-'
            ].some((prefix) => modelName.startsWith(prefix))
        ) {
            return numTokens
        }

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
            try {
                numTokens = this.__encoding.encode(text)?.length ?? numTokens
            } catch (error) {
                /* logger.warn(
                    'Failed to calculate number of tokens, falling back to approximate count',
                    error
                ) */
            }
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

    get fileHandlingConfig() {
        return this._fileHandlingConfig
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

    usageReporter?: ModelUsageReporter
}

export abstract class ChatLunaBaseEmbeddings extends Embeddings {}

export class ChatLunaEmbeddings extends ChatLunaBaseEmbeddings {
    modelName = 'text-embedding-ada-002'

    batchSize = 30

    stripNewLines = true

    timeout?: number

    private _client: EmbeddingsRequester
    private _report?: ModelUsageReporter

    constructor(fields?: ChatLunaBaseEmbeddingsParams) {
        super(fields)

        this.batchSize = fields?.batchSize ?? this.batchSize
        this.stripNewLines = fields?.stripNewLines ?? this.stripNewLines
        this.timeout = fields?.timeout ?? 1000 * 60
        this.modelName = fields?.model ?? this.modelName

        this._client = fields?.client
        this._report = fields?.usageReporter
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
            let data: Awaited<ReturnType<EmbeddingsRequester['embeddings']>>
            try {
                data = await this._embeddingWithRetry({
                    model: this.modelName,
                    input
                })
            } catch (e) {
                await this._reportFailedUsage()
                throw e
            }
            const result = Array.isArray(data) ? data : data.data
            for (let j = 0; j < input.length; j += 1) {
                embeddings.push(result[j] as number[])
            }
            await this._reportUsage(
                input,
                Array.isArray(data) ? undefined : data.usage
            )
        }

        return embeddings
    }

    async embedQuery(text: string): Promise<number[]> {
        let data: Awaited<ReturnType<EmbeddingsRequester['embeddings']>>
        try {
            data = await this._embeddingWithRetry({
                model: this.modelName,
                input: this.stripNewLines ? text.replaceAll('\n', ' ') : text
            })
        } catch (e) {
            await this._reportFailedUsage()
            throw e
        }
        const result = Array.isArray(data) ? data : data.data
        await this._reportUsage(
            text,
            Array.isArray(data) ? undefined : data.usage
        )
        if (result[0] instanceof Array) {
            return result[0]
        }
        return result as number[]
    }

    private async _reportUsage(
        input: string | string[],
        usage?: UsageMetadata
    ) {
        if (this._report == null) return

        try {
            const estimated =
                usage?.input_tokens == null &&
                usage?.output_tokens == null &&
                usage?.total_tokens == null
            const inputTokens =
                usage?.input_tokens ??
                usage?.total_tokens ??
                (await estimateTextTokens(input))
            await this._report({
                callType: 'embeddings',
                usageMetadata: usage ?? {
                    input_tokens: inputTokens,
                    output_tokens: 0,
                    total_tokens: inputTokens
                },
                estimated,
                success: true
            })
        } catch (e) {
            logger.warn('Failed to report embedding usage', e)
        }
    }

    private async _reportFailedUsage() {
        if (this._report == null) return

        try {
            await this._report({
                callType: 'embeddings',
                usageMetadata: {
                    input_tokens: 0,
                    output_tokens: 0,
                    total_tokens: 0
                },
                estimated: false,
                success: false
            })
        } catch (e) {
            logger.warn('Failed to report embedding usage', e)
        }
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

            const timeoutPromise = new Promise<
                Awaited<ReturnType<EmbeddingsRequester['embeddings']>>
            >(
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

type UsageSession = {
    platform?: string
    userId?: string
    guildId?: string
    channelId?: string
}

type UsageConfig = {
    session?: UsageSession
    conversationId?: string
    requestId?: string
    userId?: string
    guildId?: string
    agentContext?: ModelUsageContext & { channelId?: string }
}

function usageContextFromOptions(options: ChatLunaModelCallOptions) {
    const cfg = (
        options as ChatLunaModelCallOptions & {
            configurable?: UsageConfig
        }
    ).configurable
    const vars = (options.variables_hide ?? options.variables) as
        | {
              built?: ModelUsageContext & {
                  session?: UsageSession
                  channelId?: string
              }
          }
        | undefined
    const built = vars?.built
    const session = cfg?.session ?? built?.session
    const context: ModelUsageContext = {
        chatPlatform: built?.chatPlatform ?? session?.platform,
        conversationId:
            (typeof options.id === 'string' ? options.id : undefined) ??
            built?.conversationId ??
            cfg?.conversationId ??
            cfg?.agentContext?.conversationId,
        requestId:
            built?.requestId ?? cfg?.requestId ?? cfg?.agentContext?.requestId,
        userId:
            built?.userId ??
            cfg?.userId ??
            cfg?.agentContext?.userId ??
            session?.userId,
        guildId:
            built?.guildId ??
            cfg?.guildId ??
            cfg?.agentContext?.guildId ??
            session?.guildId
    }

    return context.chatPlatform != null ||
        context.conversationId != null ||
        context.requestId != null ||
        context.userId != null ||
        context.guildId != null
        ? context
        : undefined
}

function formatUsageMetadata(usage: UsageMetadata) {
    const result = [
        `Token usage from API: input=${usage.input_tokens}`,
        `output=${usage.output_tokens}`,
        `total=${usage.total_tokens}`
    ]
    const input = [
        ...(usage.input_token_details?.audio != null
            ? [`audio=${usage.input_token_details.audio}`]
            : []),
        ...(usage.input_token_details?.cache_read != null
            ? [`cache_read=${usage.input_token_details.cache_read}`]
            : []),
        ...(usage.input_token_details?.cache_creation != null
            ? [`cache_creation=${usage.input_token_details.cache_creation}`]
            : [])
    ]
    const output = [
        ...(usage.output_token_details?.audio != null
            ? [`audio=${usage.output_token_details.audio}`]
            : []),
        ...(usage.output_token_details?.reasoning != null
            ? [`reasoning=${usage.output_token_details.reasoning}`]
            : [])
    ]

    if (input.length > 0) {
        result.push(`| input(${input.join(', ')})`)
    }

    if (output.length > 0) {
        result.push(`| output(${output.join(', ')})`)
    }

    return result.join(' ')
}
