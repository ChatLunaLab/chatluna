import { AgentAction, AgentFinish } from '@langchain/core/agents'
import { AgentMultiActionOutputParser } from '../types.js'
/**
 * Parses ReAct-style LLM calls that support multiple tool inputs using XML tags.
 *
 * Expects output to be in one of two formats.
 *
 * If the output signals that actions should be taken,
 * should be in the below format. This will result in AgentAction[]
 * being returned.
 *
 * ```
 * <thought>agent thought here</thought>
 * <tool_calling>
 * [
 *   {
 *     "name": "search",
 *     "arguments": {"query": "what is the temperature in SF?"}
 *   },
 *   {
 *     "name": "calculator",
 *     "arguments": {"expression": "2 + 2"}
 *   }
 * ]
 * </tool_calling>
 * ```
 *
 * If the output signals that a final answer should be given,
 * should be in the below format. This will result in an AgentFinish
 * being returned.
 *
 * ```
 * <thought>agent thought here</thought>
 * <tool_calling>
 * [
 *   {
 *     "name": "final_answer",
 *     "arguments": {"answer": "The temperature is 100 degrees"}
 *   }
 * ]
 * </tool_calling>
 * ```
 * @example
 * ```typescript
 *
 * const runnableAgent = RunnableSequence.from([
 *   ...rest of runnable
 *   new ReActMultiInputOutputParser({ toolNames: ["SerpAPI", "Calculator"] }),
 * ]);
 * const agent = AgentExecutor.fromAgentAndTools({
 *   agent: runnableAgent,
 *   tools: [new SerpAPI(), new Calculator()],
 * });
 * const result = await agent.invoke({
 *   input: "whats the weather in pomfret?",
 * });
 * ```
 */
export declare class ReActMultiInputOutputParser extends AgentMultiActionOutputParser {
    lc_namespace: string[]
    private toolNames
    constructor(fields: { toolNames: string[] })
    /**
     * Parses the given text into an AgentAction[] or AgentFinish object.
     * @param text Text to parse.
     * @returns Promise that resolves to an AgentAction[] or AgentFinish object.
     */
    parse(text: string): Promise<AgentAction[] | AgentFinish>
    parseActions(
        toolCallingContent: string,
        thoughts: string
    ): AgentAction[] | AgentFinish

    /**
     * Returns the format instructions as a string.
     * @param options Options for getting the format instructions.
     * @returns Format instructions as a string.
     */
    getFormatInstructions(): string
}
export declare class ReActSingleInputOutputParser extends ReActMultiInputOutputParser {
    constructor(fields: { toolNames: string[] })
}
