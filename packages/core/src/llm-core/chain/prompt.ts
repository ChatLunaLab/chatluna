/* eslint-disable max-len */
import { Document } from '@langchain/core/documents'
import {
    BaseMessage,
    HumanMessage,
    MessageContent
} from '@langchain/core/messages'
import {
    BaseChatPromptTemplate,
    HumanMessagePromptTemplate,
    MessagesPlaceholder
} from '@langchain/core/prompts'
import { ChainValues, PartialValues } from '@langchain/core/utils/types'
import {
    ChatLunaContextManagerService,
    PresetTemplate,
    PromptContextRuntime,
    registerAfterUserMessageMiddleware,
    registerAuthorsNoteMiddleware,
    registerChatHistoryMiddleware,
    registerInjectionsMiddleware,
    registerLongHistoryMiddleware,
    registerLoreBooksMiddleware,
    registerReadFilesContextMiddleware,
    registerSystemPromptsMiddleware
} from 'koishi-plugin-chatluna/llm-core/prompt'
import { logger } from 'koishi-plugin-chatluna'
import { SystemPrompts } from 'koishi-plugin-chatluna/llm-core/chain/base'
import { Logger } from 'koishi'
import { truncateMessageContentUrls } from 'koishi-plugin-chatluna/utils/langchain'
import { trackLogToLocal } from 'koishi-plugin-chatluna/utils/logger'
import type {
    ChatLunaPromptRenderService,
    RenderConfigurable
} from 'koishi-plugin-chatluna/services/chat'
import { ComputedRef } from '@vue/reactivity'

export interface ChatLunaChatPromptInput {
    messagesPlaceholder?: MessagesPlaceholder
    tokenCounter: (text: string) => Promise<number>
    sendTokenLimit?: number
    preset: ComputedRef<PresetTemplate>
    partialVariables?: PartialValues
    promptRenderService: ChatLunaPromptRenderService
    contextManager: ChatLunaContextManagerService
}

export interface ChatLunaChatPromptFormat {
    input: BaseMessage
    chat_history: BaseMessage[] | string
    variables?: ChainValues
    agent_scratchpad?: BaseMessage[] | BaseMessage
    instructions?: string
    configurable?: RenderConfigurable
    after_user_message?: BaseMessage
}

export class ChatLunaChatPrompt
    extends BaseChatPromptTemplate<ChatLunaChatPromptFormat>
    implements ChatLunaChatPromptInput
{
    preset: ComputedRef<PresetTemplate>

    tokenCounter: (text: string) => Promise<number>

    conversationSummaryPrompt?: HumanMessagePromptTemplate

    _tempPreset?: [PresetTemplate, SystemPrompts]

    sendTokenLimit?: number

    promptRenderService: ChatLunaPromptRenderService

    contextManager: ChatLunaContextManagerService

    partialVariables: PartialValues = {}

    private _systemPrompts: BaseMessage[]

    private fields: ChatLunaChatPromptInput

    constructor(fields: ChatLunaChatPromptInput) {
        super({
            inputVariables: [
                'chat_history',
                'variables',
                'input',
                'agent_scratchpad',
                'instructions',
                'configurable'
            ]
        })

        this.partialVariables = fields.partialVariables

        this.tokenCounter = fields.tokenCounter

        this.sendTokenLimit = fields.sendTokenLimit ?? 4096
        this.preset = fields.preset
        this.promptRenderService = fields.promptRenderService

        if (fields.contextManager == null) {
            throw new Error('contextManager is required')
        }

        this.contextManager = fields.contextManager
        this.fields = fields

        this._ensurePipelineRegistered()
    }

    _getPromptType() {
        return 'chatluna_chat' as const
    }

    /**
     * Register the built-in pipeline and injection middlewares on the
     * context manager. This is done once per context manager; subsequent
     * calls (including across prompt instances) are no-ops.
     */
    private _ensurePipelineRegistered() {
        const cm = this.contextManager
        if (cm == null) {
            throw new Error('contextManager is required')
        }

        cm.ensureCoreMiddlewares(() => {
            // Pipeline stages (execute in STAGE_ORDER)
            registerSystemPromptsMiddleware(cm)
            registerChatHistoryMiddleware(cm)
            registerLongHistoryMiddleware(cm)
            registerInjectionsMiddleware(cm)

            // Injection middlewares (per-name, triggered during 'injections' stage)
            registerLoreBooksMiddleware(cm)
            registerAuthorsNoteMiddleware(cm)
            registerAfterUserMessageMiddleware(cm)
            registerReadFilesContextMiddleware(cm)
        })
    }

    // -----------------------------------------------------------------------
    // Main entry point
    // -----------------------------------------------------------------------

    async formatMessages({
        chat_history: chatHistory,
        input,
        variables,
        agent_scratchpad: agentScratchpad,
        instructions,
        after_user_message: afterUserMessage,
        configurable
    }: ChatLunaChatPromptFormat) {
        instructions =
            instructions ??
            (typeof this.partialVariables?.instructions === 'function'
                ? await this.partialVariables.instructions()
                : this.partialVariables?.instructions)

        // Handle scratchpad type normalisation
        if (agentScratchpad && typeof agentScratchpad === 'string') {
            agentScratchpad = new HumanMessage(agentScratchpad)
        }

        // Prepare document collections
        const longHistory = (variables?.['long_memory'] ?? []) as Document[]
        const knowledge = (variables?.['knowledge'] ?? []) as Document[]
        const otherDocuments = (variables?.['documents'] ?? []) as Document[][]

        const documents = [longHistory, knowledge].concat(
            Array.isArray(otherDocuments[0])
                ? otherDocuments
                : [otherDocuments as unknown as Document[]]
        )

        const normalizedChatHistory: BaseMessage[] = Array.isArray(chatHistory)
            ? chatHistory
            : typeof chatHistory === 'string'
              ? [new HumanMessage(chatHistory)]
              : []

        // Build the runtime that flows through the entire pipeline
        const runtime: PromptContextRuntime = {
            result: [],
            variables: variables ?? {},
            configurable,
            usedTokens: 0,
            sendTokenLimit: this.sendTokenLimit ?? 4096,
            tokenCounter: this.tokenCounter,
            promptRenderService: this.promptRenderService,
            preset: this.preset.value,
            input,
            chatHistory: normalizedChatHistory,
            documents,
            agentScratchpad,
            instructions,
            afterUserMessage: agentScratchpad ? afterUserMessage : undefined
        }

        // Run the full pipeline
        if (this.contextManager == null) {
            throw new Error('contextManager is required')
        }

        await this.contextManager.runPipeline(runtime)

        // Cache system prompts for backward compat
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this._systemPrompts = (runtime as any)._systemPrompts ?? []
        this._tempPreset = [this.preset.value, this._systemPrompts]

        // Debug logging
        if (logger?.level === Logger.DEBUG) {
            const name = runtime.configurable?.agentContext?.agentName || 'main'
            if (runtime.usedTokens > runtime.sendTokenLimit) {
                logger?.debug(
                    '[Agent %s] Used tokens: %c exceed limit: %c',
                    name,
                    runtime.usedTokens,
                    runtime.sendTokenLimit
                )
            } else {
                logger?.debug(
                    '[Agent %s] Used tokens: %c, token limit: %c',
                    name,
                    runtime.usedTokens,
                    runtime.sendTokenLimit
                )
            }

            const mapMessages = runtime.result.map((msg) => {
                const original = msg?.toDict?.()

                if (original == null) return msg

                const content = original.data.content as MessageContent

                if (Array.isArray(content)) {
                    original.data.content = truncateMessageContentUrls(
                        content
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ) as any
                }

                return original
            })

            await trackLogToLocal(
                'ChatLunaPrompt',
                JSON.stringify(mapMessages),
                logger
            )
        }

        return runtime.result
    }

    get tempPreset() {
        return this._tempPreset?.[0]
    }

    async partial<NewPartialVariableName extends string>(
        values: PartialValues<NewPartialVariableName>
    ) {
        return this.partialSync(values)
    }

    partialSync<NewPartialVariableName extends string>(
        values: PartialValues<NewPartialVariableName>
    ) {
        const newInputVariables = this.inputVariables.filter(
            (iv) => !(iv in values)
        )

        const newPartialVariables = {
            ...(this.partialVariables ?? {}),
            ...values
        }
        const promptDict = {
            ...this.fields,
            inputVariables: newInputVariables,
            partialVariables: newPartialVariables
        }
        return new ChatLunaChatPrompt(promptDict)
    }
}
