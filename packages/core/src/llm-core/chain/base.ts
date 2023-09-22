import {
    CallbackManager,
    CallbackManagerForChainRun,
    Callbacks
} from 'langchain/callbacks'
import { BaseChain, ChainInputs, SerializedLLMChain } from 'langchain/chains'
import { BaseMessage, ChainValues, HumanMessage } from 'langchain/schema'
import { BaseLLMOutputParser } from 'langchain/schema/output_parser'
import { StructuredTool } from 'langchain/tools'
import { ChatEvents } from '../../services/types'
import { BufferMemory, ConversationSummaryMemory } from 'langchain/memory'
import { ChatHubChatModel, ChatHubModelCallOptions } from '../platform/model'
import { BasePromptTemplate } from 'langchain/prompts'

export const FINISH_NAME = 'finish'

export type ObjectTool = StructuredTool

export type SystemPrompts = BaseMessage[]

export abstract class ChatHubLLMChainWrapper {
    abstract call(arg: ChatHubLLMCallArg): Promise<ChainValues>

    abstract historyMemory: ConversationSummaryMemory | BufferMemory

    abstract get model(): ChatHubChatModel
}

export interface ChatHubLLMCallArg {
    message: HumanMessage
    events: ChatEvents
    stream: boolean
    conversationId: string
}

export interface ChatHubLLMChainInput extends ChainInputs {
    /** Prompt object to use */
    prompt: BasePromptTemplate
    /** LLM Wrapper to use */
    llm: ChatHubChatModel
    /** Kwargs to pass to LLM */
    llmKwargs?: this['llm']['CallOptions']
    /** OutputParser to use */
    outputParser?: BaseLLMOutputParser<ChatHubChatModel>
    /** Key to use for output, defaults to `text` */
    outputKey?: string
}

export class ChatHubLLMChain extends BaseChain implements ChatHubLLMChainInput {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_serializable = false

    prompt: BasePromptTemplate

    llm: ChatHubChatModel

    outputKey = 'text'

    llmKwargs?: this['llm']['CallOptions']

    get inputKeys() {
        return this.prompt.inputVariables
    }

    get outputKeys() {
        return [this.outputKey]
    }

    constructor(fields: ChatHubLLMChainInput) {
        super(fields)
        this.prompt = fields.prompt
        this.llm = fields.llm
        this.outputKey = fields.outputKey ?? this.outputKey
        this.llmKwargs = fields.llmKwargs
    }

    /**
     * Run the core logic of this chain and add to output if desired.
     *
     * Wraps _call and handles memory.
     */
    call(
        values: ChainValues & this['llm']['CallOptions'],
        callbacks?: Callbacks | undefined
    ): Promise<ChainValues> {
        return super.call(values, callbacks)
    }

    /** @ignore */
    _selectMemoryInputs(values: ChainValues): ChainValues {
        const valuesForMemory = super._selectMemoryInputs(values)
        for (const key of this.llm.callKeys) {
            if (key in values) {
                delete valuesForMemory[key]
            }
        }
        return valuesForMemory
    }

    /** @ignore */
    async _call(
        values: ChainValues & this['llm']['CallOptions'],
        runManager?: CallbackManagerForChainRun
    ): Promise<ChainValues> {
        const valuesForPrompt = { ...values }
        const valuesForLLM: ChatHubModelCallOptions = {
            ...this.llmKwargs
        }

        for (const key of this.llm.callKeys) {
            if (key in values) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                valuesForLLM[key as any] = values[key]
                delete valuesForPrompt[key]
            }
        }
        const promptValue = await this.prompt.formatPromptValue(valuesForPrompt)
        const { generations } = await this.llm.generatePrompt(
            [promptValue],
            valuesForLLM as ChatHubModelCallOptions,
            runManager?.getChild()
        )

        const generation = generations[0][0]

        return {
            [this.outputKey]: generation.text,
            rawGeneration: generation,
            extra: generation?.generationInfo
        }
    }

    /**
     * Format prompt with values and pass to LLM
     *
     * @param values - keys to pass to prompt template
     * @param callbackManager - CallbackManager to use
     * @returns Completion from LLM.
     *
     * @example
     * ```ts
     * llm.predict({ adjective: "funny" })
     * ```
     */
    async predict(
        values: ChainValues & this['llm']['CallOptions'],
        callbackManager?: CallbackManager
    ): Promise<string> {
        const output = await this.call(values, callbackManager)
        return output[this.outputKey]
    }

    _chainType() {
        return 'chathub_chain' as const
    }

    static async deserialize(data: SerializedLLMChain): Promise<BaseChain> {
        throw new Error('Not implemented')
    }

    serialize(): SerializedLLMChain {
        throw new Error('Not implemented')
    }
}

declare module 'langchain/chains' {
    interface ChainValues {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extra?: Record<string, any>
    }
}
