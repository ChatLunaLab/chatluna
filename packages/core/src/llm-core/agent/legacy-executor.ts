import { CallbackManagerForChainRun } from '@langchain/core/callbacks/manager'
import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage
} from '@langchain/core/messages'
import { isDirectToolOutput } from '@langchain/core/messages/tool'
import { OutputParserException } from '@langchain/core/output_parsers'
import {
    patchConfig,
    Runnable,
    type RunnableConfig
} from '@langchain/core/runnables'
import {
    StructuredTool,
    ToolInputParsingException
} from '@langchain/core/tools'
import type { ChainValues } from '@langchain/core/utils/types'
import {
    BaseChain,
    ChainInputs
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { isRequestFailure } from 'koishi-plugin-chatluna/utils/error'
import {
    AgentAction,
    AgentCallbackEvent,
    AgentEvent,
    AgentFinish,
    AgentObservation,
    AgentRuntimeConfigurable,
    AgentStep,
    applyToolMask,
    CHATLUNA_AGENT_EVENT,
    MessageQueue
} from './types'
import {
    type AgentLoopState,
    applyLoopGuidance,
    coerceToAgentObservation,
    createAgentLoopState,
    repairToolAction,
    toOutput,
    toToolInputErrorObservation
} from './tool-observation'
import { _formatIntermediateSteps } from './openai'
import type { ContextState } from '../chat/context'

async function executeTools(
    actions: AgentAction[],
    toolMap: Record<string, StructuredTool>,
    config: RunnableConfig | undefined,
    signal: AbortSignal | undefined,
    handleParsingErrors: boolean | string | ((e: Error) => string),
    handleToolRuntimeErrors?: (e: Error) => string,
    state?: AgentLoopState
) {
    return Promise.all(
        actions.map(async (action) => {
            checkAborted(signal)

            if (action.tool === '_Exception') {
                return {
                    action,
                    observation: coerceToAgentObservation(
                        typeof action.toolInput === 'string'
                            ? action.toolInput
                            : (JSON.stringify(action.toolInput) ?? '')
                    )
                } as AgentStep
            }

            const input =
                typeof action.toolInput === 'string'
                    ? action.toolInput
                    : JSON.stringify(action.toolInput)
            const inputKey = input ?? ''
            const toolKey = `${action.tool?.toLowerCase()}:${inputKey}`
            if (state) {
                const count = (state.calls.get(toolKey) ?? 0) + 1
                state.calls.set(toolKey, count)

                if (count === 2) {
                    return {
                        action,
                        observation:
                            `Warning: tool '${action.tool}' was called ` +
                            'again with the exact same input. The call was ' +
                            'skipped to prevent a loop. Do not repeat the ' +
                            'same call; change arguments, use another tool, ' +
                            'or explain the blocker.'
                    } as AgentStep
                }

                if (count >= 3) {
                    return {
                        action,
                        observation:
                            `Error: repeated duplicate call to ` +
                            `'${action.tool}'. Stop repeating this call, ` +
                            'change strategy, or finish with a blocker ' +
                            'summary for the user.'
                    } as AgentStep
                }
            }

            const tool = toolMap[action.tool?.toLowerCase()]

            if (tool == null) {
                return {
                    action,
                    observation:
                        `Tool '${action.tool}' is not valid. Do not call ` +
                        'this tool again. Try another tool, change strategy, ' +
                        'or finish with a blocker summary for the user.'
                } as AgentStep
            }

            const context = (
                config?.configurable as AgentRuntimeConfigurable | undefined
            )?.agentContext
            const mask = context?.toolMask
            if (mask && !applyToolMask(action.tool, mask)) {
                const allowed = Object.values(toolMap)
                    .map((item) => item.name)
                    .filter((name) => applyToolMask(name, mask))

                return {
                    action,
                    observation:
                        `Tool '${action.tool}' is not allowed for the ` +
                        `current agent. Available tools: ${allowed.join(', ')}. ` +
                        'Do not retry this tool. Try an allowed tool, ' +
                        'change strategy, or finish with a blocker summary ' +
                        'for the user.'
                } as AgentStep
            }

            const callMask = context?.toolMask?.toolCallMask
            if (callMask && !applyToolMask(action.tool, callMask)) {
                return {
                    action,
                    observation:
                        `You do not have permission to call tool ` +
                        `'${action.tool}'. Do not retry this tool. Try ` +
                        'another tool, change strategy, or finish with a ' +
                        'blocker summary for the user.'
                } as AgentStep
            }

            try {
                const observation = coerceToAgentObservation(
                    await tool.invoke(action.toolInput, config),
                    tool.name
                )
                checkAborted(signal)

                return {
                    action,
                    observation: applyLoopGuidance(
                        state,
                        action,
                        observation,
                        false
                    )
                } as AgentStep
            } catch (e) {
                checkAborted(signal)

                if (e instanceof ToolInputParsingException) {
                    const observation = coerceToAgentObservation(
                        toToolInputErrorObservation(handleParsingErrors, e)
                    )
                    return {
                        action,
                        observation: applyLoopGuidance(
                            state,
                            action,
                            observation,
                            true
                        )
                    } as AgentStep
                }

                if (handleToolRuntimeErrors != null) {
                    const observation = coerceToAgentObservation(
                        handleToolRuntimeErrors(e as Error),
                        tool.name
                    )
                    return {
                        action,
                        observation: applyLoopGuidance(
                            state,
                            action,
                            observation,
                            true
                        )
                    } as AgentStep
                }

                const observation = coerceToAgentObservation(
                    `Tool execution failed: ${String(e)}. Do not ` +
                        'retry with the exact same input. Change the ' +
                        'arguments, use a different tool, change ' +
                        'strategy, or finish with a blocker summary.',
                    tool.name
                )

                return {
                    action,
                    observation: applyLoopGuidance(
                        state,
                        action,
                        observation,
                        true
                    )
                } as AgentStep
            }
        })
    )
}

async function plan(
    agent: Runnable,
    input: ChainValues,
    steps: AgentStep[],
    context: ContextState,
    config: RunnableConfig | undefined,
    signal?: AbortSignal
) {
    const stream = await agent.stream(
        {
            ...input,
            chat_history: context.history,
            steps,
            configurable: {
                ...input.configurable,
                ...config?.configurable,
                context
            }
        },
        config
    )

    let result: AgentAction[] | AgentAction | AgentFinish | undefined

    for await (const chunk of stream) {
        checkAborted(signal)

        if (result !== undefined) {
            throw new Error('Multiple outputs from agent stream')
        }

        result = chunk as AgentAction[] | AgentAction | AgentFinish
    }

    if (result == null) {
        throw new Error('No output from agent stream')
    }

    if (!Array.isArray(result) && 'returnValues' in result) {
        return result
    }

    return Array.isArray(result) ? result : [result]
}

// eslint-disable-next-line generator-star-spacing
export async function* runAgent(
    options: RunAgentOptions
): AsyncGenerator<AgentEvent> {
    const steps: AgentStep[] = []
    const signal =
        options.signal ?? (options.config?.signal as AbortSignal | undefined)
    const runtime = {
        ...options.input.configurable,
        ...options.config?.configurable
    } as AgentRuntimeConfigurable
    const context: ContextState = runtime.context ?? {
        history: Array.isArray(options.input.chat_history)
            ? [...options.input.chat_history]
            : typeof options.input.chat_history === 'string'
              ? [new HumanMessage(options.input.chat_history)]
              : [],
        autoCompactWindow:
            options.input.autoCompactWindow ??
            runtime.autoCompactWindow ??
            'auto',
        onCompact: options.input.onCompact
    }
    runtime.context = context
    const config = {
        ...patchConfig(options.config, {
            ...(signal == null ? {} : { signal }),
            configurable: runtime
        }),
        ...(options.input.maxTokens == null
            ? {}
            : { maxTokens: options.input.maxTokens }),
        ...(options.input.maxContextWindow == null
            ? {}
            : { maxContextWindow: options.input.maxContextWindow })
    }
    const appendHistory = (messages: BaseMessage[]) => {
        const input = options.input.input
        if (input != null) {
            context.history.push(
                ...(Array.isArray(input)
                    ? input
                    : [
                          typeof input === 'string'
                              ? new HumanMessage(input)
                              : input
                      ])
            )
            options.input.input = undefined
        }
        context.history.push(...messages)
    }
    const queue = options.messageQueue ?? runtime.messageQueue
    const toolMap = Object.fromEntries(
        options.tools.map((tool) => [tool.name.toLowerCase(), tool])
    )
    const maxIterations = options.maxIterations ?? 105
    const handleParsingErrors = options.handleParsingErrors ?? true

    let iterations = 0
    const loopState = createAgentLoopState()

    while (iterations < maxIterations) {
        checkAborted(signal)
        await runtime.pauseGate?.(signal)
        checkAborted(signal)

        const pending = queue?.drain() ?? []
        if (pending.length > 0) {
            appendHistory(pending)

            yield {
                type: 'human-update',
                messages: pending
            }
        }

        yield {
            type: 'round-decision'
        }

        let output: AgentAction[] | AgentFinish

        try {
            output = await plan(
                options.agent,
                options.input,
                steps,
                context,
                config,
                signal
            )
        } catch (e) {
            checkAborted(signal)

            if (e instanceof OutputParserException) {
                output = [toParsingErrorAction(handleParsingErrors, e)]
            } else if (
                runtime.agentContext?.kind === 'subagent' &&
                !signal?.aborted &&
                isRequestFailure(e)
            ) {
                yield {
                    type: 'round-decision',
                    canContinue: false
                }

                yield {
                    type: 'done',
                    output:
                        'Subtask execution was interrupted; the workspace ' +
                        'may have been modified.',
                    log: e instanceof Error ? e.message : String(e),
                    steps
                }

                return
            } else {
                throw e
            }
        }

        checkAborted(signal)

        if (!Array.isArray(output) && 'returnValues' in output) {
            const message = output.returnValues['message'] as AIMessageChunk

            yield {
                type: 'round-decision',
                canContinue: false
            }

            const pending = queue?.drain() ?? []
            if (pending.length > 0) {
                appendHistory(pending)
                yield {
                    type: 'human-update',
                    messages: pending
                }
            }

            yield {
                type: 'done',
                output: toOutput(output.returnValues['output']),
                log: output.log,
                steps,
                message
            }

            return
        }

        output = output.map((action) => repairToolAction(action, toolMap))

        if (output.length > 0) {
            yield {
                type: 'round-decision'
            }

            yield {
                type: 'tool-call',
                actions: output
            }
        }

        const newSteps = await executeTools(
            output,
            toolMap,
            config,
            signal,
            handleParsingErrors,
            options.handleToolRuntimeErrors,
            loopState
        )

        steps.push(...newSteps)

        if (newSteps.length > 0) {
            const messages = _formatIntermediateSteps(newSteps)
            appendHistory(messages)
            yield {
                type: 'tool-result',
                steps: newSteps,
                messages
            }
        }

        const last = newSteps[newSteps.length - 1]
        const tool = last ? toolMap[last.action.tool?.toLowerCase()] : undefined
        const replyEmitted =
            last?.observation != null &&
            typeof last.observation === 'object' &&
            'replyEmitted' in last.observation &&
            last.observation.replyEmitted === true

        if (
            last != null &&
            (tool?.returnDirect || isDirectToolOutput(last.observation))
        ) {
            yield {
                type: 'round-decision',
                canContinue: false
            }

            const pending = queue?.drain() ?? []
            if (pending.length > 0) {
                appendHistory(pending)
                yield {
                    type: 'human-update',
                    messages: pending
                }
            }

            yield {
                type: 'done',
                output:
                    // TODO: remove this property
                    replyEmitted ? '' : toOutput(last.observation),
                log: last.action.log,
                steps,
                replyEmitted
            }

            return
        }

        yield {
            type: 'round-decision',
            canContinue: true
        }

        iterations += 1
    }

    yield {
        type: 'round-decision',
        canContinue: false
    }

    yield {
        type: 'done',
        output: 'Agent stopped due to iteration limit.',
        log: '',
        steps
    }
}

export async function emitAgentEvent(
    runManager: CallbackManagerForChainRun | undefined,
    configurable: AgentRuntimeConfigurable,
    event: AgentEvent
) {
    const payload = {
        context: configurable.agentContext,
        event
    } satisfies AgentCallbackEvent
    await runManager?.handleCustomEvent(CHATLUNA_AGENT_EVENT, payload)
}

export class LegacyAgentExecutor extends BaseChain<
    ChainValues,
    AgentExecutorOutput
> {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_serializable = false

    agent: Runnable

    tools: StructuredTool[]

    returnIntermediateSteps = false

    maxIterations?: number

    handleParsingErrors?: boolean | string | ((e: Error) => string)

    handleToolRuntimeErrors?: (e: Error) => string

    constructor(fields: AgentExecutorInput) {
        super(fields)
        this.agent = fields.agent
        this.tools = fields.tools
        this.returnIntermediateSteps = fields.returnIntermediateSteps ?? false
        this.maxIterations = fields.maxIterations
        this.handleParsingErrors = fields.handleParsingErrors
        this.handleToolRuntimeErrors = fields.handleToolRuntimeErrors
    }

    get inputKeys() {
        return ['input']
    }

    get outputKeys() {
        return ['output']
    }

    static fromAgentAndTools(fields: AgentExecutorInput) {
        return new LegacyAgentExecutor(fields)
    }

    async _call(
        inputs: ChainValues,
        runManager?: CallbackManagerForChainRun,
        config?: RunnableConfig
    ): Promise<AgentExecutorOutput> {
        const configurable = (config?.configurable ??
            {}) as AgentRuntimeConfigurable

        const runner = runAgent({
            agent: this.agent,
            tools: this.tools,
            input: inputs,
            signal: config?.signal as AbortSignal | undefined,
            maxIterations: this.maxIterations,
            handleParsingErrors: this.handleParsingErrors,
            handleToolRuntimeErrors: this.handleToolRuntimeErrors,
            config
        })

        for await (const event of runner) {
            if (event.type === 'tool-call') {
                for (const action of event.actions) {
                    await runManager?.handleAgentAction(action)
                }
            }

            await emitAgentEvent(runManager, configurable, event)
            await configurable.onAgentEvent?.(event)

            if (event.type === 'done') {
                const returnValues = event.message
                    ? {
                          output: event.output,
                          message: event.message
                      }
                    : {
                          output: event.output
                      }

                await runManager?.handleAgentEnd({
                    returnValues,
                    log: event.log
                })

                return {
                    output: event.output,
                    ...(this.returnIntermediateSteps
                        ? {
                              intermediateSteps: event.steps
                          }
                        : {}),
                    message: event.message ?? new AIMessage(event.output)
                }
            }
        }

        throw new Error('Agent executor did not return a final output')
    }

    _chainType() {
        return 'agent_executor' as const
    }
}

export interface RunAgentOptions {
    agent: Runnable
    tools: StructuredTool[]
    input: ChainValues
    messageQueue?: MessageQueue
    signal?: AbortSignal
    maxIterations?: number
    handleParsingErrors?: boolean | string | ((e: Error) => string)
    handleToolRuntimeErrors?: (e: Error) => string
    config?: RunnableConfig
}

export interface AgentExecutorInput extends ChainInputs {
    agent: Runnable
    tools: StructuredTool[]
    returnIntermediateSteps?: boolean
    maxIterations?: number
    handleParsingErrors?: boolean | string | ((e: Error) => string)
    handleToolRuntimeErrors?: (e: Error) => string
}

export interface AgentExecutorOutput extends ChainValues {
    output: string
    intermediateSteps?: AgentStep[]
    message: AIMessage
}

export {
    coerceToAgentObservation,
    observationToMessageContent,
    toToolInputErrorObservation
} from './tool-observation'

function checkAborted(signal?: AbortSignal) {
    if (!signal?.aborted) {
        return
    }

    throw signal.reason ?? new Error('Aborted')
}

function toParsingErrorAction(
    handleParsingErrors: boolean | string | ((e: Error) => string),
    error: OutputParserException
): AgentAction {
    let observation: AgentObservation
    let text = error.message

    if (handleParsingErrors === true) {
        observation = coerceToAgentObservation(error.observation)
        text = error.llmOutput ?? ''
    } else if (typeof handleParsingErrors === 'string') {
        observation = handleParsingErrors
    } else if (typeof handleParsingErrors === 'function') {
        observation = handleParsingErrors(error)
    } else {
        throw error
    }

    return {
        tool: '_Exception',
        toolInput:
            typeof observation === 'string'
                ? observation
                : (JSON.stringify(observation) ?? ''),
        log: text
    }
}
