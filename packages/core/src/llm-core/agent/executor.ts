import { CallbackManager } from '@langchain/core/callbacks/manager'
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
    isMessageContentComplex,
    isMessageContentText
} from 'koishi-plugin-chatluna/utils/langchain'
import {
    AgentAction,
    AgentEvent,
    AgentFinish,
    AgentObservation,
    AgentStep,
    MessageQueue,
    ScratchpadEntry
} from './types'

export interface RunAgentOptions {
    agent: Runnable
    tools: StructuredTool[]
    input: ChainValues
    messageQueue?: MessageQueue
    signal?: AbortSignal
    maxIterations?: number
    handleParsingErrors?: boolean | string | ((e: Error) => string)
    config?: RunnableConfig
}

function isAgentObservation(value: unknown): value is AgentObservation {
    if (typeof value === 'string') {
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
        return 'Invalid or incomplete tool input. Please try again.'
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
        if (error.sendToLLM) {
            observation = coerceToAgentObservation(error.observation)
            text = error.llmOutput ?? ''
        } else {
            observation = 'Invalid or incomplete response'
        }
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

async function executeTools(
    actions: AgentAction[],
    toolMap: Record<string, StructuredTool>,
    config: RunnableConfig | undefined,
    signal: AbortSignal | undefined,
    handleParsingErrors: boolean | string | ((e: Error) => string)
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
    config: RunnableConfig | undefined,
    messageQueue?: MessageQueue
) {
    let hasToolCallChunk = false
    let finalAnswerStarted = false

    const callbacks = CallbackManager.configure(
        config?.callbacks,
        [
            {
                handleLLMNewToken() {
                    if (hasToolCallChunk || finalAnswerStarted) {
                        return
                    }

                    finalAnswerStarted = true
                    messageQueue?.close()
                },
                handleCustomEvent(name, data) {
                    if (name !== 'LLMNewChunk' || data == null) {
                        return
                    }

                    hasToolCallChunk = true
                }
            }
        ],
        config?.tags,
        undefined,
        config?.metadata,
        undefined,
        {
            verbose: false
        }
    )

    const patched = patchConfig(config, {
        callbacks
    })

    const stream = await agent.stream(
        {
            ...input,
            steps,
            scratchpadEntries: scratchpad
        },
        patched
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
        return {
            output: result,
            finalAnswerStarted
        }
    }

    return {
        output: Array.isArray(result) ? result : [result],
        finalAnswerStarted
    }
}

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
    const toolMap = Object.fromEntries(
        options.tools.map((tool) => [tool.name.toLowerCase(), tool])
    )
    const maxIterations = options.maxIterations ?? 105
    const handleParsingErrors = options.handleParsingErrors ?? false

    let iterations = 0

    while (iterations < maxIterations) {
        checkAborted(signal)

        const pending = options.messageQueue?.drain() ?? []
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

        let output: AgentAction[] | AgentFinish
        let finalAnswerStarted = false

        try {
            const result = await plan(
                options.agent,
                options.input,
                steps,
                scratchpad,
                config,
                options.messageQueue
            )

            output = result.output
            finalAnswerStarted = result.finalAnswerStarted
        } catch (e) {
            if (!(e instanceof OutputParserException)) {
                throw e
            }

            output = [toParsingErrorAction(handleParsingErrors, e)]
        }

        checkAborted(signal)

        if (finalAnswerStarted) {
            yield {
                type: 'final-answer-start'
            }
        }

        if (isAgentFinish(output)) {
            const pending = options.messageQueue?.drain() ?? []
            if (pending.length > 0) {
                yield {
                    type: 'human-update',
                    messages: pending
                }
            }

            yield {
                type: 'done',
                output: toOutput(output.returnValues['output']),
                steps
            }

            return
        }

        if (output.length > 0) {
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
            handleParsingErrors
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

        if (tool?.returnDirect && last != null) {
            const pending = options.messageQueue?.drain() ?? []
            if (pending.length > 0) {
                yield {
                    type: 'human-update',
                    messages: pending
                }
            }

            yield {
                type: 'done',
                output: toOutput(last.observation),
                steps
            }

            return
        }

        iterations += 1
    }

    yield {
        type: 'done',
        output: 'Agent stopped due to iteration limit.',
        steps
    }
}
