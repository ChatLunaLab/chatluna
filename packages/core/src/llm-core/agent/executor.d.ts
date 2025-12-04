import {
    type StructuredToolInterface,
    Tool,
    ToolInputParsingException,
    type ToolInterface
} from '@langchain/core/tools'
import { Runnable, type RunnableConfig } from '@langchain/core/runnables'
import { ChainValues } from '@langchain/core/utils/types'
import {
    CallbackManagerForChainRun,
    Callbacks
} from '@langchain/core/callbacks/manager'
import { OutputParserException } from '@langchain/core/output_parsers'
import { AgentAction, AgentFinish, AgentStep, StoppingMethod } from './types'
import { BaseMultiActionAgent, BaseSingleActionAgent } from './agent'
import {
    BaseChain,
    ChainInputs
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { Serializable } from '@langchain/core/load/serializable'
interface AgentExecutorIteratorInput {
    agentExecutor: AgentExecutor
    inputs: Record<string, string>
    config?: RunnableConfig
    /** @deprecated Use "config" */
    callbacks?: Callbacks
    /** @deprecated Use "config" */
    tags?: string[]
    /** @deprecated Use "config" */
    metadata?: Record<string, unknown>
    runName?: string
    runManager?: CallbackManagerForChainRun
}
export declare class AgentExecutorIterator
    extends Serializable
    implements AgentExecutorIteratorInput
{
    lc_namespace: string[]
    agentExecutor: AgentExecutor
    inputs: Record<string, string>
    config?: RunnableConfig
    /** @deprecated Use "config" */
    callbacks?: Callbacks
    /** @deprecated Use "config" */
    tags: string[] | undefined
    /** @deprecated Use "config" */
    metadata: Record<string, unknown> | undefined
    /** @deprecated Use "config" */
    runName: string | undefined
    private _finalOutputs
    get finalOutputs(): Record<string, unknown> | undefined
    /** Intended to be used as a setter method, needs to be async. */
    setFinalOutputs(value: Record<string, unknown> | undefined): Promise<void>
    runManager: CallbackManagerForChainRun | undefined
    intermediateSteps: AgentStep[]
    iterations: number
    get nameToToolMap(): Record<string, ToolInterface>
    constructor(fields: AgentExecutorIteratorInput)
    /**
     * Reset the iterator to its initial state, clearing intermediate steps,
     * iterations, and the final output.
     */
    reset(): void
    updateIterations(): void
    streamIterator(): AsyncGenerator<
        Record<string, unknown>,
        Record<string, unknown>,
        unknown
    >

    /**
     * Perform any necessary setup for the first step
     * of the asynchronous iterator.
     */
    onFirstStep(): Promise<void>
    /**
     * Execute the next step in the chain using the
     * AgentExecutor's _takeNextStep method.
     */
    _executeNextStep(
        runManager?: CallbackManagerForChainRun
    ): Promise<AgentFinish | AgentStep[]>

    /**
     * Process the output of the next step,
     * handling AgentFinish and tool return cases.
     */
    _processNextStepOutput(
        nextStepOutput: AgentFinish | AgentStep[],
        runManager?: CallbackManagerForChainRun
    ): Promise<Record<string, string | AgentStep[]>>

    _stop(): Promise<Record<string, unknown>>
    _callNext(): Promise<Record<string, unknown>>
}
type ExtractToolType<T> = T extends {
    ToolType: infer ToolInterface
}
    ? ToolInterface
    : StructuredToolInterface
/**
 * Interface defining the structure of input data for creating an
 * AgentExecutor. It extends ChainInputs and includes additional
 * properties specific to agent execution.
 */
export interface AgentExecutorInput extends ChainInputs {
    agent:
        | BaseSingleActionAgent
        | BaseMultiActionAgent
        | Runnable<
              ChainValues & {
                  steps?: AgentStep[]
              },
              AgentAction[] | AgentAction | AgentFinish
          >
    tools: ExtractToolType<this['agent']>[]
    returnIntermediateSteps?: boolean
    maxIterations?: number
    earlyStoppingMethod?: StoppingMethod
    handleParsingErrors?:
        | boolean
        | string
        | ((e: OutputParserException | ToolInputParsingException) => string)
    handleToolRuntimeErrors?: (e: Error) => string
}
export type AgentExecutorOutput = ChainValues
/**
 * Tool that just returns the query.
 * Used for exception tracking.
 */
export declare class ExceptionTool extends Tool {
    name: string
    description: string
    _call(query: string): Promise<string>
}
/**
 * A chain managing an agent using tools.
 * @augments BaseChain
 * @example
 * ```typescript
 *
 * const executor = AgentExecutor.fromAgentAndTools({
 *   agent: async () => loadAgentFromLangchainHub(),
 *   tools: [new SerpAPI(), new Calculator()],
 *   returnIntermediateSteps: true,
 * });
 *
 * const result = await executor.invoke({
 *   input: `Who is Olivia Wilde's boyfriend? What is his current age raised to the 0.23 power?`,
 * });
 *
 * ```
 */
export declare class AgentExecutor extends BaseChain<
    ChainValues,
    AgentExecutorOutput
> {
    static lc_name(): string
    get lc_namespace(): string[]
    agent: BaseSingleActionAgent | BaseMultiActionAgent
    tools: this['agent']['ToolType'][]
    returnIntermediateSteps: boolean
    maxIterations?: number
    earlyStoppingMethod: StoppingMethod
    returnOnlyOutputs: boolean
    /**
     * How to handle errors raised by the agent's output parser.
      Defaults to `False`, which raises the error.

      If `true`, the error will be sent back to the LLM as an observation.
      If a string, the string itself will be sent to the LLM as an observation.
      If a callable function, the function will be called with the exception
      as an argument, and the result of that function will be passed to the agent
      as an observation.
     */
    handleParsingErrors:
        | boolean
        | string
        | ((e: OutputParserException | ToolInputParsingException) => string)

    handleToolRuntimeErrors?: (e: Error) => string
    get inputKeys(): string[]
    get outputKeys(): string[]
    constructor(input: AgentExecutorInput)
    /** Create from agent and a list of tools. */
    static fromAgentAndTools(fields: AgentExecutorInput): AgentExecutor
    get shouldContinueGetter(): any
    /**
     * Method that checks if the agent execution should continue based on the
     * number of iterations.
     * @param iterations The current number of iterations.
     * @returns A boolean indicating whether the agent execution should continue.
     */
    private shouldContinue
    /** @ignore */
    _call(
        inputs: ChainValues,
        runManager?: CallbackManagerForChainRun,
        config?: RunnableConfig
    ): Promise<AgentExecutorOutput>

    _takeNextStep(
        nameToolMap: Record<string, ToolInterface>,
        inputs: ChainValues,
        intermediateSteps: AgentStep[],
        runManager?: CallbackManagerForChainRun,
        config?: RunnableConfig
    ): Promise<AgentFinish | AgentStep[]>

    _return(
        output: AgentFinish,
        intermediateSteps: AgentStep[],
        runManager?: CallbackManagerForChainRun
    ): Promise<AgentExecutorOutput>

    _getToolReturn(nextStepOutput: AgentStep): Promise<AgentFinish | null>
    _returnStoppedResponse(earlyStoppingMethod: StoppingMethod): AgentFinish
    _streamIterator(
        inputs: Record<string, any>,
        options?: Partial<RunnableConfig>
    ): AsyncGenerator<ChainValues>

    _chainType(): 'agent_executor'
}
export {}
