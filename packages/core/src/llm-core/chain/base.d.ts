import {
    CallbackManager,
    CallbackManagerForChainRun,
    Callbacks
} from '@langchain/core/callbacks/manager'
import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { BaseLLMOutputParser } from '@langchain/core/output_parsers'
import { BasePromptTemplate } from '@langchain/core/prompts'
import { RunnableConfig } from '@langchain/core/runnables'
import { ChainValues } from '@langchain/core/utils/types'
import { Session } from 'koishi'
import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { ChatEvents } from '../../services/types'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    BaseLangChain,
    BaseLangChainParams
} from '@langchain/core/language_models/base'
import { BaseMemory } from '@langchain/core/memory'
import type { PostHandler } from '../../utils/types'
export type SystemPrompts = BaseMessage[]
export declare abstract class ChatLunaLLMChainWrapper {
    abstract call(arg: ChatLunaLLMCallArg): Promise<ChainValues>
    abstract historyMemory: BufferMemory
    abstract get model(): ChatLunaChatModel
}
export interface ChatLunaLLMCallArg {
    message: HumanMessage
    events: ChatEvents
    stream: boolean
    conversationId: string
    session: Session
    variables?: Record<string, any>
    signal?: AbortSignal
    postHandler?: PostHandler
    maxToken?: number
}
export interface ChatLunaLLMChainInput extends ChainInputs {
    /** Prompt object to use */
    prompt?: BasePromptTemplate
    /** LLM Wrapper to use */
    llm?: ChatLunaChatModel
    /** Kwargs to pass to LLM */
    llmKwargs?: this['llm']['ParsedCallOptions']
    /** OutputParser to use */
    outputParser?: BaseLLMOutputParser<ChatLunaChatModel>
    /** Key to use for output, defaults to `text` */
    outputKey?: string
}
export type LoadValues = Record<string, any>
export interface ChainInputs extends BaseLangChainParams {
    memory?: BaseMemory
    /**
     * @deprecated Use `callbacks` instead
     */
    callbackManager?: CallbackManager
}
/**
 * Base interface that all chains must implement.
 */
export declare abstract class BaseChain<
    RunInput extends ChainValues = ChainValues,
    RunOutput extends ChainValues = ChainValues
>
    extends BaseLangChain<RunInput, RunOutput>
    implements ChainInputs
{
    memory?: BaseMemory
    get lc_namespace(): string[]
    constructor(
        fields?: BaseMemory | ChainInputs,
        /** @deprecated */
        verbose?: boolean,
        /** @deprecated */
        callbacks?: Callbacks
    )

    /** @ignore */
    _selectMemoryInputs(values: ChainValues): ChainValues
    /**
     * Invoke the chain with the provided input and returns the output.
     * @param input Input values for the chain run.
     * @param config Optional configuration for the Runnable.
     * @returns Promise that resolves with the output of the chain run.
     */
    invoke(input: RunInput, options?: RunnableConfig): Promise<RunOutput>
    private _validateOutputs
    prepOutputs(
        inputs: Record<string, unknown>,
        outputs: Record<string, unknown>,
        returnOnlyOutputs?: boolean
    ): Promise<Record<string, unknown>>

    /**
     * Run the core logic of this chain and return the output
     */
    abstract _call(
        values: RunInput,
        runManager?: CallbackManagerForChainRun,
        config?: RunnableConfig
    ): Promise<RunOutput>

    /**
     * Return the string type key uniquely identifying this class of chain.
     */
    abstract _chainType(): string
    /**
     * Return a json-like object representing this chain.
     */
    serialize(): unknown
    abstract get inputKeys(): string[]
    abstract get outputKeys(): string[]
    protected _formatValues(
        values: ChainValues & {
            signal?: AbortSignal
            timeout?: number
        }
    ): Promise<
        ChainValues & {
            signal?: AbortSignal
            timeout?: number
        }
    >

    /**
     * Load a chain from a json-like object describing it.
     */
    static deserialize(data: unknown, values?: LoadValues): Promise<BaseChain>
}
export declare class ChatLunaLLMChain<
    RunInput extends ChainValues = ChainValues,
    RunOutput extends ChainValues = ChainValues
>
    extends BaseChain<RunInput, RunOutput>
    implements ChatLunaLLMChainInput
{
    lc_serializable: boolean
    prompt: BasePromptTemplate
    llm: ChatLunaChatModel
    outputKey: string
    llmKwargs?: this['llm']['ParsedCallOptions']
    get inputKeys(): string[]
    get outputKeys(): string[]
    constructor(fields: ChatLunaLLMChainInput)
    /** @ignore */
    _call(
        values: RunInput & this['llm']['ParsedCallOptions'],
        runManager?: CallbackManagerForChainRun
    ): Promise<RunOutput>

    /** @ignore */
    _selectMemoryInputs(values: ChainValues): ChainValues
    _chainType(): 'chatluna_chain'
    get lc_namespace(): string[]
}
export declare function callChatLunaChain(
    chain: ChatLunaLLMChain,
    values: ChainValues & ChatLunaLLMChain['llm']['ParsedCallOptions'],
    events: ChatEvents
): Promise<ChainValues>
