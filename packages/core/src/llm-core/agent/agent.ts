import type { StructuredToolInterface } from '@langchain/core/tools'
import { CallbackManager, Callbacks } from '@langchain/core/callbacks/manager'
import { AgentAction, AgentFinish, AgentStep } from '@langchain/core/agents'
import { ChainValues } from '@langchain/core/utils/types'
import { Serializable } from '@langchain/core/load/serializable'
import {
    patchConfig,
    Runnable,
    type RunnableConfig,
    RunnableLike,
    RunnableSequence
} from '@langchain/core/runnables'
import type {
    AgentActionOutputParser,
    RunnableMultiActionAgentInput,
    RunnableSingleActionAgentInput,
    StoppingMethod
} from './types'

/**
 * Record type for arguments passed to output parsers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OutputParserArgs = Record<string, any>

/**
 * Abstract base class for agents in LangChain. Provides common
 * functionality for agents, such as handling inputs and outputs.
 */
export abstract class BaseAgent extends Serializable {
    declare ToolType: StructuredToolInterface

    abstract get inputKeys(): string[]

    get returnValues(): string[] {
        return ['output']
    }

    get allowedTools(): string[] | undefined {
        return undefined
    }

    /**
     * Return the string type key uniquely identifying this class of agent.
     */
    _agentType(): string {
        throw new Error('Not implemented')
    }

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
    ): Promise<AgentFinish> {
        if (earlyStoppingMethod === 'force') {
            return Promise.resolve({
                returnValues: {
                    output: 'Agent stopped due to max iterations.'
                },
                log: ''
            })
        }

        throw new Error(`Invalid stopping method: ${earlyStoppingMethod}`)
    }

    /**
     * Prepare the agent for output, if needed
     */
    async prepareForOutput(
        _returnValues: AgentFinish['returnValues'],
        _steps: AgentStep[]
    ): Promise<AgentFinish['returnValues']> {
        return {}
    }
}

/**
 * Abstract base class for single action agents in LangChain. Extends the
 * BaseAgent class and provides additional functionality specific to
 * single action agents.
 */
export abstract class BaseSingleActionAgent extends BaseAgent {
    _agentActionType(): string {
        return 'single' as const
    }

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
export abstract class BaseMultiActionAgent extends BaseAgent {
    _agentActionType(): string {
        return 'multi' as const
    }

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

function isAgentAction(input: unknown): input is AgentAction {
    return !Array.isArray(input) && (input as AgentAction)?.tool !== undefined
}

export function isRunnableAgent(x: BaseAgent) {
    return (
        (x as RunnableMultiActionAgent | RunnableSingleActionAgent).runnable !==
        undefined
    )
}

// TODO: Remove in the future. Only for backwards compatibility.
// Allows for the creation of runnables with properties that will
// be passed to the agent executor constructor.
export class AgentRunnableSequence<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    RunInput = any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    RunOutput = any
> extends RunnableSequence<RunInput, RunOutput> {
    streamRunnable?: boolean

    singleAction: boolean

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static fromRunnables<RunInput = any, RunOutput = any>(
        [first, ...runnables]: [
            RunnableLike<RunInput>,
            ...RunnableLike[],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            RunnableLike<any, RunOutput>
        ],
        config: {
            singleAction: boolean
            streamRunnable?: boolean
            name?: string
        }
    ): AgentRunnableSequence<RunInput, Exclude<RunOutput, Error>> {
        const sequence = RunnableSequence.from(
            [first, ...runnables],
            config.name
        ) as AgentRunnableSequence<RunInput, Exclude<RunOutput, Error>>
        sequence.singleAction = config.singleAction
        sequence.streamRunnable = config.streamRunnable
        return sequence
    }

    static isAgentRunnableSequence(x: Runnable): x is AgentRunnableSequence {
        return typeof (x as AgentRunnableSequence).singleAction === 'boolean'
    }
}

/**
 * Class representing a single-action agent powered by runnables.
 * Extends the BaseSingleActionAgent class and provides methods for
 * planning agent actions with runnables.
 */
export class RunnableSingleActionAgent extends BaseSingleActionAgent {
    lc_namespace = ['langchain', 'agents', 'runnable']

    runnable: Runnable<
        ChainValues & { steps: AgentStep[] },
        AgentAction | AgentFinish
    >

    get inputKeys(): string[] {
        return []
    }

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
    streamRunnable = true

    defaultRunName = 'RunnableAgent'

    constructor(fields: RunnableSingleActionAgentInput) {
        super(fields)
        this.runnable = fields.runnable
        this.defaultRunName =
            fields.defaultRunName ?? this.runnable.name ?? this.defaultRunName
        this.streamRunnable = fields.streamRunnable ?? this.streamRunnable
    }

    async plan(
        steps: AgentStep[],
        inputs: ChainValues,
        callbackManager?: CallbackManager,
        config?: RunnableConfig
    ): Promise<AgentAction | AgentFinish> {
        const combinedInput = { ...inputs, steps }
        const combinedConfig = patchConfig(config, {
            callbacks: callbackManager,
            runName: this.defaultRunName
        })
        if (this.streamRunnable) {
            const stream = await this.runnable.stream(
                combinedInput,
                combinedConfig
            )
            let finalOutput: AgentAction | AgentFinish | undefined
            for await (const chunk of stream) {
                if (finalOutput === undefined) {
                    finalOutput = chunk
                } else {
                    throw new Error(
                        [
                            `Multiple agent actions/finishes received in streamed agent output.`,
                            `Set "streamRunnable: false" when initializing the agent to invoke this agent in non-streaming mode.`
                        ].join('\n')
                    )
                }
            }
            if (finalOutput === undefined) {
                throw new Error(
                    [
                        'No streaming output received from underlying runnable.',
                        `Set "streamRunnable: false" when initializing the agent to invoke this agent in non-streaming mode.`
                    ].join('\n')
                )
            }
            return finalOutput
        } else {
            return this.runnable.invoke(combinedInput, combinedConfig)
        }
    }
}

/**
 * Class representing a multi-action agent powered by runnables.
 * Extends the BaseMultiActionAgent class and provides methods for
 * planning agent actions with runnables.
 */
export class RunnableMultiActionAgent extends BaseMultiActionAgent {
    lc_namespace = ['langchain', 'agents', 'runnable']

    // TODO: Rename input to "intermediate_steps"
    runnable: Runnable<
        ChainValues & { steps: AgentStep[] },
        AgentAction[] | AgentAction | AgentFinish
    >

    defaultRunName = 'RunnableAgent'

    stop?: string[]

    streamRunnable = true

    get inputKeys(): string[] {
        return []
    }

    constructor(fields: RunnableMultiActionAgentInput) {
        super(fields)
        this.runnable = fields.runnable
        this.stop = fields.stop
        this.defaultRunName =
            fields.defaultRunName ?? this.runnable.name ?? this.defaultRunName
        this.streamRunnable = fields.streamRunnable ?? this.streamRunnable
    }

    async plan(
        steps: AgentStep[],
        inputs: ChainValues,
        callbackManager?: CallbackManager,
        config?: RunnableConfig
    ): Promise<AgentAction[] | AgentFinish> {
        const combinedInput = { ...inputs, steps }
        const combinedConfig = patchConfig(config, {
            callbacks: callbackManager,
            runName: this.defaultRunName
        })
        let output
        if (this.streamRunnable) {
            const stream = await this.runnable.stream(
                combinedInput,
                combinedConfig
            )
            let finalOutput:
                | AgentAction
                | AgentFinish
                | AgentAction[]
                | undefined
            for await (const chunk of stream) {
                if (finalOutput === undefined) {
                    finalOutput = chunk
                } else {
                    throw new Error(
                        [
                            `Multiple agent actions/finishes received in streamed agent output.`,
                            `Set "streamRunnable: false" when initializing the agent to invoke this agent in non-streaming mode.`
                        ].join('\n')
                    )
                }
            }
            if (finalOutput === undefined) {
                throw new Error(
                    [
                        'No streaming output received from underlying runnable.',
                        `Set "streamRunnable: false" when initializing the agent to invoke this agent in non-streaming mode.`
                    ].join('\n')
                )
            }
            output = finalOutput
        } else {
            output = await this.runnable.invoke(combinedInput, combinedConfig)
        }

        if (isAgentAction(output)) {
            return [output]
        }

        return output
    }
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
