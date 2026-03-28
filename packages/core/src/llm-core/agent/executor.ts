/* eslint-disable generator-star-spacing */
import { CallbackManagerForChainRun } from '@langchain/core/callbacks/manager'
import { AIMessage } from '@langchain/core/messages'
import { Runnable, RunnableConfig } from '@langchain/core/runnables'
import type { StructuredTool } from '@langchain/core/tools'
import type { ChainValues } from '@langchain/core/utils/types'
import type { AgentRuntimeConfigurable } from './types'
import { runAgent } from './legacy-executor'
import type { AgentExecutorInput, AgentExecutorOutput } from './legacy-executor'

export {
    coerceToAgentObservation,
    LegacyAgentExecutor,
    runAgent,
    toToolInputErrorObservation,
    type AgentExecutorInput,
    type AgentExecutorOutput,
    type RunAgentOptions
} from './legacy-executor'

export class AgentRunner extends Runnable<ChainValues, AgentRunnerOutput> {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_serializable = false

    lc_namespace = ['chatluna', 'agent']

    agent: Runnable

    tools: StructuredTool[]

    returnIntermediateSteps = false

    maxIterations?: number

    handleParsingErrors?: boolean | string | ((e: Error) => string)

    handleToolRuntimeErrors?: (e: Error) => string

    constructor(fields: AgentRunnerInput) {
        super(fields)
        this.agent = fields.agent
        this.tools = fields.tools
        this.returnIntermediateSteps = fields.returnIntermediateSteps ?? false
        this.maxIterations = fields.maxIterations
        this.handleParsingErrors = fields.handleParsingErrors
        this.handleToolRuntimeErrors = fields.handleToolRuntimeErrors
    }

    static fromAgentAndTools(fields: AgentRunnerInput) {
        return new AgentRunner(fields)
    }

    private async *_run(
        input: ChainValues,
        config?: RunnableConfig,
        runManager?: CallbackManagerForChainRun
    ): AsyncGenerator<AgentRunnerOutput> {
        const configurable = (config?.configurable ??
            {}) as AgentRunnerConfigurable

        const runner = runAgent({
            agent: this.agent,
            tools: this.tools,
            input,
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

            if (event.type !== 'done') {
                continue
            }

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

            yield {
                output: event.output,
                ...(this.returnIntermediateSteps
                    ? {
                          intermediateSteps: event.steps
                      }
                    : {}),
                message: event.message ?? new AIMessage(event.output)
            }
            return
        }

        throw new Error('Agent runner did not return a final output')
    }

    async invoke(
        input: ChainValues,
        options?: RunnableConfig
    ): Promise<AgentRunnerOutput> {
        return this._callWithConfig(
            async (values, config, runManager) => {
                let result: AgentRunnerOutput | undefined

                for await (const chunk of this._run(
                    values,
                    config,
                    runManager
                )) {
                    result = chunk
                }

                if (result == null) {
                    throw new Error(
                        'Agent runner did not return a final output'
                    )
                }

                return result
            },
            input,
            options
        )
    }

    async *_streamIterator(
        input: ChainValues,
        options?: RunnableConfig
    ): AsyncGenerator<AgentRunnerOutput> {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const outer = this

        yield* this._transformStreamWithConfig(
            (async function* () {
                yield input
            })(),
            async function* (generator, runManager, config) {
                let values: ChainValues | undefined

                for await (const chunk of generator) {
                    values =
                        values == null
                            ? chunk
                            : Object.assign({}, values, chunk)
                }

                if (values == null) {
                    throw new Error('Agent runner requires input')
                }

                yield* outer._run(values, config, runManager)
            },
            options
        )
    }
}

export const AgentExecutor = AgentRunner

export type AgentExecutor = AgentRunner

export type AgentRunnerInput = AgentExecutorInput

export type AgentRunnerOutput = AgentExecutorOutput

type AgentRunnerConfigurable = AgentRuntimeConfigurable
