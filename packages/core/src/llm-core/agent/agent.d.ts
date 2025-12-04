import type { StructuredToolInterface } from '@langchain/core/tools'
import { CallbackManager, Callbacks } from '@langchain/core/callbacks/manager'
import { ChainValues } from '@langchain/core/utils/types'
import { Serializable } from '@langchain/core/load/serializable'
import {
    Runnable,
    type RunnableConfig,
    RunnableLike,
    RunnableSequence
} from '@langchain/core/runnables'
import type {
    AgentAction,
    AgentActionOutputParser,
    AgentFinish,
    AgentStep,
    RunnableMultiActionAgentInput,
    RunnableSingleActionAgentInput,
    StoppingMethod
} from './types'
/**
 * Record type for arguments passed to output parsers.
 */
export type OutputParserArgs = Record<string, any>
/**
 * Abstract base class for agents in LangChain. Provides common
 * functionality for agents, such as handling inputs and outputs.
 */
export declare abstract class BaseAgent extends Serializable {
    ToolType: StructuredToolInterface
    abstract get inputKeys(): string[]
    get returnValues(): string[]
    get allowedTools(): string[] | undefined
    /**
     * Return the string type key uniquely identifying this class of agent.
     */
    _agentType(): string
    /**
     * Return the string type key uniquely identifying multi or single action agents.
     */
    abstract _agentActionType(): string
    /**
     * Return response when agent has been stopped due to max iterations
     */
    returnStoppedResponse(
        earlyStoppingMethod: StoppingMethod,
        _steps: AgentStep[],
        _inputs: ChainValues,
        _callbackManager?: CallbackManager
    ): Promise<AgentFinish>

    /**
     * Prepare the agent for output, if needed
     */
    prepareForOutput(
        _returnValues: AgentFinish['returnValues'],
        _steps: AgentStep[]
    ): Promise<AgentFinish['returnValues']>
}
/**
 * Abstract base class for single action agents in LangChain. Extends the
 * BaseAgent class and provides additional functionality specific to
 * single action agents.
 */
export declare abstract class BaseSingleActionAgent extends BaseAgent {
    _agentActionType(): string
    /**
     * Decide what to do, given some input.
     *
     * @param steps - Steps the LLM has taken so far, along with observations from each.
     * @param inputs - User inputs.
     * @param callbackManager - Callback manager.
     *
     * @returns Action specifying what tool to use.
     */
    abstract plan(
        steps: AgentStep[],
        inputs: ChainValues,
        callbackManager?: CallbackManager,
        config?: RunnableConfig
    ): Promise<AgentAction | AgentFinish>
}
/**
 * Abstract base class for multi-action agents in LangChain. Extends the
 * BaseAgent class and provides additional functionality specific to
 * multi-action agents.
 */
export declare abstract class BaseMultiActionAgent extends BaseAgent {
    _agentActionType(): string
    /**
     * Decide what to do, given some input.
     *
     * @param steps - Steps the LLM has taken so far, along with observations from each.
     * @param inputs - User inputs.
     * @param callbackManager - Callback manager.
     *
     * @returns Actions specifying what tools to use.
     */
    abstract plan(
        steps: AgentStep[],
        inputs: ChainValues,
        callbackManager?: CallbackManager,
        config?: RunnableConfig
    ): Promise<AgentAction[] | AgentFinish>
}
export declare function isRunnableAgent(x: BaseAgent): boolean
export declare class AgentRunnableSequence<
    RunInput = any,
    RunOutput = any
> extends RunnableSequence<RunInput, RunOutput> {
    streamRunnable?: boolean
    singleAction: boolean
    static fromRunnables<RunInput = any, RunOutput = any>(
        [first, ...runnables]: [
            RunnableLike<RunInput>,
            ...RunnableLike[],
            RunnableLike<any, RunOutput>
        ],
        config: {
            singleAction: boolean
            streamRunnable?: boolean
            name?: string
        }
    ): AgentRunnableSequence<RunInput, Exclude<RunOutput, Error>>

    static isAgentRunnableSequence(x: Runnable): x is AgentRunnableSequence
}
/**
 * Class representing a single-action agent powered by runnables.
 * Extends the BaseSingleActionAgent class and provides methods for
 * planning agent actions with runnables.
 */
export declare class RunnableSingleActionAgent extends BaseSingleActionAgent {
    lc_namespace: string[]
    runnable: Runnable<
        ChainValues & {
            steps: AgentStep[]
        },
        AgentAction | AgentFinish
    >

    get inputKeys(): string[]
    /**
     * Whether to stream from the runnable or not.
     * If true, the underlying LLM is invoked in a streaming fashion to make it
     * possible to get access to the individual LLM tokens when using
     * `streamLog` with the Agent Executor. If false then LLM is invoked in a
     * non-streaming fashion and individual LLM tokens will not be available
     * in `streamLog`.
     *
     * Note that the runnable should still only stream a single action or
     * finish chunk.
     */
    streamRunnable: boolean
    defaultRunName: string
    constructor(fields: RunnableSingleActionAgentInput)
    plan(
        steps: AgentStep[],
        inputs: ChainValues,
        callbackManager?: CallbackManager,
        config?: RunnableConfig
    ): Promise<AgentAction | AgentFinish>
}
/**
 * Class representing a multi-action agent powered by runnables.
 * Extends the BaseMultiActionAgent class and provides methods for
 * planning agent actions with runnables.
 */
export declare class RunnableMultiActionAgent extends BaseMultiActionAgent {
    lc_namespace: string[]
    runnable: Runnable<
        ChainValues & {
            steps: AgentStep[]
        },
        AgentAction[] | AgentAction | AgentFinish
    >

    defaultRunName: string
    stop?: string[]
    streamRunnable: boolean
    get inputKeys(): string[]
    constructor(fields: RunnableMultiActionAgentInput)
    plan(
        steps: AgentStep[],
        inputs: ChainValues,
        callbackManager?: CallbackManager,
        config?: RunnableConfig
    ): Promise<AgentAction[] | AgentFinish>
}
/**
 * Interface for arguments used to create an agent in LangChain.
 */
export interface AgentArgs {
    outputParser?: AgentActionOutputParser
    callbacks?: Callbacks
    /**
     * @deprecated Use `callbacks` instead.
     */
    callbackManager?: CallbackManager
}
