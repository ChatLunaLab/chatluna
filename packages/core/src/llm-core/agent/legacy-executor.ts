import { CallbackManagerForChainRun } from '@langchain/core/callbacks/manager'
import { AIMessage, AIMessageChunk } from '@langchain/core/messages'
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
import { logger } from 'koishi-plugin-chatluna'
import {
    BaseChain,
    ChainInputs
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import {
    isMessageContentComplex,
    isMessageContentText
} from 'koishi-plugin-chatluna/utils/langchain'
import {
    AgentAction,
    AgentEvent,
    AgentFinish,
    AgentObservation,
    AgentRuntimeConfigurable,
    AgentStep,
    applyToolMask,
    MessageQueue,
    ScratchpadEntry
} from './types'

async function executeTools(
    actions: AgentAction[],
    toolMap: Record<string, StructuredTool>,
    config: RunnableConfig | undefined,
    signal: AbortSignal | undefined,
    handleParsingErrors: boolean | string | ((e: Error) => string),
    handleToolRuntimeErrors?: (e: Error) => string
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

            const tool = toolMap[action.tool?.toLowerCase()]

            if (tool == null) {
                return {
                    action,
                    observation: `${action.tool} is not a valid tool, try another one.`
                } as AgentStep
            }

            const mask =
                config?.configurable?.['toolMask'] ??
                config?.configurable?.['subagentContext']?.['toolMask']
            if (mask && !applyToolMask(action.tool, mask)) {
                const allowed = Object.values(toolMap)
                    .map((item) => item.name)
                    .filter((name) => applyToolMask(name, mask))

                return {
                    action,
                    observation: `Tool '${action.tool}' is not allowed for the current sub-agent. Available tools: ${allowed.join(', ')}`
                } as AgentStep
            }

            const callMask =
                config?.configurable?.['toolMask']?.toolCallMask ??
                config?.configurable?.['subagentContext']?.['toolMask']
                    ?.toolCallMask
            if (callMask && !applyToolMask(action.tool, callMask)) {
                return {
                    action,
                    observation: `You do not have permission to call tool '${action.tool}'. Try another tool.`
                } as AgentStep
            }

            try {
                const observation = await tool.invoke(action.toolInput, config)
                return {
                    action,
                    observation: coerceToAgentObservation(
                        observation,
                        tool.name
                    )
                } as AgentStep
            } catch (e) {
                if (e instanceof ToolInputParsingException) {
                    return {
                        action,
                        observation: coerceToAgentObservation(
                            toToolInputErrorObservation(handleParsingErrors, e)
                        )
                    } as AgentStep
                }

                if (handleToolRuntimeErrors != null) {
                    return {
                        action,
                        observation: coerceToAgentObservation(
                            handleToolRuntimeErrors(e as Error),
                            tool.name
                        )
                    } as AgentStep
                }

                return {
                    action,
                    observation: coerceToAgentObservation(
                        `Something went wrong. Please Try Again. ${String(e)}`,
                        tool.name
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
    scratchpad: ScratchpadEntry[],
    config: RunnableConfig | undefined
) {
    const stream = await agent.stream(
        {
            ...input,
            steps,
            scratchpadEntries: scratchpad
        },
        config
    )

    let result: AgentAction[] | AgentAction | AgentFinish | undefined

    for await (const chunk of stream) {
        if (result !== undefined) {
            throw new Error('Multiple outputs from agent stream')
        }

        result = chunk as AgentAction[] | AgentAction | AgentFinish
    }

    if (result == null) {
        throw new Error('No output from agent stream')
    }

    if (isAgentFinish(result)) {
        return result
    }

    return Array.isArray(result) ? result : [result]
}

// eslint-disable-next-line generator-star-spacing
export async function* runAgent(
    options: RunAgentOptions
): AsyncGenerator<AgentEvent> {
    const steps: AgentStep[] = []
    const scratchpad: ScratchpadEntry[] = []
    const signal =
        options.signal ?? (options.config?.signal as AbortSignal | undefined)
    const config =
        signal == null
            ? options.config
            : patchConfig(options.config, { signal })
    const runtime = (config?.configurable ?? {}) as AgentRuntimeConfigurable
    const queue = options.messageQueue ?? runtime.messageQueue
    const toolMap = Object.fromEntries(
        options.tools.map((tool) => [tool.name.toLowerCase(), tool])
    )
    const maxIterations = options.maxIterations ?? 105
    const handleParsingErrors = options.handleParsingErrors ?? true

    let iterations = 0

    while (iterations < maxIterations) {
        checkAborted(signal)

        const pending = queue?.drain() ?? []
        if (pending.length > 0) {
            scratchpad.push({
                type: 'human_update',
                messages: pending
            })

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
                scratchpad,
                config
            )
        } catch (e) {
            if (!(e instanceof OutputParserException)) {
                throw e
            }

            output = [toParsingErrorAction(handleParsingErrors, e)]
        }

        checkAborted(signal)

        if (isAgentFinish(output)) {
            const message = output.returnValues['message'] as AIMessageChunk

            yield {
                type: 'round-decision',
                canContinue: false
            }

            const pending = queue?.drain() ?? []
            if (pending.length > 0) {
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
            options.handleToolRuntimeErrors
        )

        steps.push(...newSteps)
        scratchpad.push(...newSteps)

        if (newSteps.length > 0) {
            yield {
                type: 'tool-result',
                steps: newSteps
            }
        }

        const last = newSteps[newSteps.length - 1]
        const tool = last ? toolMap[last.action.tool?.toLowerCase()] : undefined

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
                yield {
                    type: 'human-update',
                    messages: pending
                }
            }

            yield {
                type: 'done',
                output:
                    // TODO: remove this property
                    last.observation['replyEmitted'] === true
                        ? ''
                        : toOutput(last.observation),
                log: last.action.log,
                steps,
                replyEmitted: last.observation['replyEmitted'] === true
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

function isAgentObservation(value: unknown): value is AgentObservation {
    if (typeof value === 'string') {
        return true
    }

    if (isDirectToolOutput(value)) {
        return true
    }

    if (!Array.isArray(value)) {
        return false
    }

    return value.every((item) => isMessageContentComplex(item))
}

export function coerceToAgentObservation(
    observation: unknown,
    toolName?: string
): AgentObservation {
    if (isDirectToolOutput(observation)) {
        return observation
    }

    if (isAgentObservation(observation)) {
        if (
            Array.isArray(observation) &&
            observation.every(isMessageContentText)
        ) {
            return observation.map((item) => item.text).join('')
        }

        return observation
    }

    logger.warn(
        `Tool ${toolName ?? 'unknown'} returned unsupported observation type`,
        observation
    )

    try {
        return JSON.stringify(observation) ?? String(observation)
    } catch {
        return String(observation)
    }
}

export function toToolInputErrorObservation(
    handleParsingErrors: boolean | string | ((e: Error) => string),
    error: ToolInputParsingException
): AgentObservation {
    if (handleParsingErrors === true || handleParsingErrors === false) {
        return (
            'Invalid or incomplete tool input.' +
            error.message +
            ' ' +
            error.output +
            'Please try again.'
        )
    }

    if (typeof handleParsingErrors === 'string') {
        return handleParsingErrors
    }

    return handleParsingErrors(error)
}

function toOutput(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }

    if (Array.isArray(value) && value.every(isMessageContentText)) {
        return value.map((item) => item.text).join('')
    }

    try {
        return JSON.stringify(value) ?? String(value)
    } catch {
        return String(value)
    }
}

function isAgentFinish(
    output: AgentAction[] | AgentAction | AgentFinish
): output is AgentFinish {
    return !Array.isArray(output) && 'returnValues' in output
}

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
