import type { StructuredTool } from '@langchain/core/tools'
import { AgentStep } from '@langchain/core/agents'
import { AgentRunnableSequence } from 'koishi-plugin-chatluna/llm-core/agent'
import type { ChatLunaChatModel } from '../../platform/model'
import type { ChatLunaChatPrompt } from '../../chain/prompt'
/**
 * Params used by the createXmlAgent function.
 */
export type CreateReactAgentParams = {
    /** LLM to use for the agent. */
    llm: ChatLunaChatModel
    /** Tools this agent has access to. */
    tools: StructuredTool[]
    /**
     * The prompt to use. Must have input keys for
     * `tools`, `tool_names`, and `agent_scratchpad`.
     */
    prompt: ChatLunaChatPrompt
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
 * const agent = createReactAgent({
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
export declare function createReactAgent({
    llm,
    tools,
    prompt,
    streamRunnable,
    instructions
}: CreateReactAgentParams): AgentRunnableSequence<
    {
        steps: AgentStep[]
    },
    | import('koishi-plugin-chatluna/llm-core/agent').AgentFinish
    | import('koishi-plugin-chatluna/llm-core/agent').AgentAction[]
>
/**
 * Construct the scratchpad that lets the agent continue its thought process.
 * @param intermediateSteps
 * @param observationPrefix
 * @param llmPrefix
 * @returns a string with the formatted observations and agent logs
 */
export declare function formatLogToString(
    intermediateSteps: AgentStep[],
    observationPrefix?: string,
    llmPrefix?: string
): string
