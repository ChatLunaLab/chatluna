import type { ToolInterface } from '@langchain/core/tools'
import { BasePromptTemplate, PromptTemplate } from '@langchain/core/prompts'
import { RunnablePassthrough } from '@langchain/core/runnables'
import { AgentStep } from '@langchain/core/agents'
import { ReActMultiInputOutputParser } from './output_parser'
import { AgentRunnableSequence } from 'koishi-plugin-chatluna/llm-core/agent'
import { renderTextDescriptionAndArgs } from '../render'
import { FORMAT_INSTRUCTIONS } from './prompt'
import type { ChatLunaChatModel } from '../../platform/model'

/**
 * Params used by the createXmlAgent function.
 */
export type CreateReactAgentParams = {
    /** LLM to use for the agent. */
    llm: ChatLunaChatModel
    /** Tools this agent has access to. */
    tools: ToolInterface[]
    /**
     * The prompt to use. Must have input keys for
     * `tools`, `tool_names`, and `agent_scratchpad`.
     */
    prompt: BasePromptTemplate
    /**
     * Whether to invoke the underlying model in streaming mode,
     * allowing streaming of intermediate steps. Defaults to true.
     */
    streamRunnable?: boolean

    instructions?: string

    /**
     * Whether to use XML format for tool descriptions. Defaults to false.
     */
    useXmlFormat?: boolean
}

/**
 * Create an agent that uses ReAct prompting.
 * @param params Params required to create the agent. Includes an LLM, tools, and prompt.
 * @returns A runnable sequence representing an agent. It takes as input all the same input
 *     variables as the prompt passed in does. It returns as output either an
 *     AgentAction or AgentFinish.
 *
 * @example
 * ```typescript
 * import { AgentExecutor, createReactAgent } from "langchain/agents";
 * import { pull } from "langchain/hub";
 * import type { PromptTemplate } from "@langchain/core/prompts";
 *
 * import { OpenAI } from "@langchain/openai";
 *
 * // Define the tools the agent will have access to.
 * const tools = [...];
 *
 * // Get the prompt to use - you can modify this!
 * // If you want to see the prompt in full, you can at:
 * // https://smith.langchain.com/hub/hwchase17/react
 * const prompt = await pull<PromptTemplate>("hwchase17/react");
 *
 * const llm = new OpenAI({
 *   temperature: 0,
 * });
 *
 * const agent = await createReactAgent({
 *   llm,
 *   tools,
 *   prompt,
 * });
 *
 * const agentExecutor = new AgentExecutor({
 *   agent,
 *   tools,
 * });
 *
 * const result = await agentExecutor.invoke({
 *   input: "what is LangChain?",
 * });
 * ```
 */
export async function createReactAgent({
    llm,
    tools,
    prompt,
    streamRunnable,
    instructions
}: CreateReactAgentParams) {
    const toolNames = tools.map((tool) => tool.name)

    // Choose the appropriate renderer based on format preference
    const toolDescriptions = renderTextDescriptionAndArgs(tools)

    const instructionsFormat = PromptTemplate.fromTemplate(
        instructions ?? FORMAT_INSTRUCTIONS
    ).format({
        tool_descriptions: toolDescriptions,
        tool_names: toolNames.join(', ')
    })

    prompt = await prompt.partial({
        instructions: () => instructionsFormat
    })

    const agent = AgentRunnableSequence.fromRunnables(
        [
            RunnablePassthrough.assign({
                agent_scratchpad: (input: { steps: AgentStep[] }) =>
                    formatLogToString(input.steps)
            }),
            prompt,
            llm,
            new ReActMultiInputOutputParser({
                toolNames
            })
        ],
        {
            name: 'ReactAgent',
            streamRunnable,
            singleAction: false
        }
    )
    return agent
}

/**
 * Construct the scratchpad that lets the agent continue its thought process.
 * @param intermediateSteps
 * @param observationPrefix
 * @param llmPrefix
 * @returns a string with the formatted observations and agent logs
 */
export function formatLogToString(
    intermediateSteps: AgentStep[],
    observationPrefix = 'Observation: ',
    llmPrefix = ''
): string {
    const formattedSteps = intermediateSteps.reduce(
        (thoughts, { action, observation }) => {
            // Format the action log and observation in a way that's consistent with XML format
            const actionLog = action.log || `Used tool: ${action.tool}`
            return (
                thoughts +
                [actionLog, `\n${observationPrefix}${observation}\n`].join('\n')
            )
        },
        ''
    )
    return formattedSteps
}
