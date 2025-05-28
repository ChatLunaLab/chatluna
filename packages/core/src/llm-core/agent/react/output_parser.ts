import { AgentAction, AgentFinish } from '@langchain/core/agents'
import { renderTemplate } from '@langchain/core/prompts'
import { OutputParserException } from '@langchain/core/output_parsers'
import { AgentMultiActionOutputParser } from '../types.js'
import { FORMAT_INSTRUCTIONS } from './prompt.js'

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
export class ReActMultiInputOutputParser extends AgentMultiActionOutputParser {
    lc_namespace = ['langchain', 'agents', 'react']

    private toolNames: string[]

    constructor(fields: { toolNames: string[] }) {
        super(fields)
        this.toolNames = fields.toolNames
    }

    /**
     * Parses the given text into an AgentAction[] or AgentFinish object.
     * @param text Text to parse.
     * @returns Promise that resolves to an AgentAction[] or AgentFinish object.
     */
    async parse(text: string): Promise<AgentAction[] | AgentFinish> {
        const thoughtRegex = /<thought>(.*?)<\/thought>/s
        const toolCallingRegex = /<tool_calling>(.*?)<\/tool_calling>/s

        const thoughtMatch = text.match(thoughtRegex)
        const toolCallingMatch = text.match(toolCallingRegex)

        if (toolCallingMatch) {
            const [, toolCallingContent] = toolCallingMatch
            const [, thoughts] = thoughtMatch || ['', '']

            const cleanedContent = toolCallingContent.trim()

            return this.parseActions(cleanedContent, thoughts.trim())
        }

        throw new OutputParserException(
            `Could not parse LLM output: ${text}`,
            `Could not parse LLM output: ${text}`,
            `Could not parse LLM output: ${text}`,
            true
        )
    }

    parseActions(
        toolCallingContent: string,
        thoughts: string
    ): AgentAction[] | AgentFinish {
        try {
            const parsedActions = JSON.parse(toolCallingContent) as unknown as {
                name: string
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                arguments: Record<string, any>
            }[]

            if (!Array.isArray(parsedActions)) {
                throw new OutputParserException(
                    `Tool calling content must be an array: ${toolCallingContent}`
                )
            }

            // Check if any action is final_answer
            const finalAnswerAction = parsedActions.find(
                (action) => action.name === 'final_answer'
            )
            if (finalAnswerAction) {
                return {
                    returnValues: { output: finalAnswerAction.arguments },
                    log: thoughts
                }
            }

            // Return multiple actions
            return parsedActions.map((action) => {
                if (action.name == null || action.arguments == null) {
                    throw new OutputParserException(
                        `Invalid action format: ${JSON.stringify(action)}`
                    )
                }

                return {
                    tool: action.name,
                    toolInput: action.arguments || {},
                    log: thoughts
                }
            })
        } catch (e) {
            throw new OutputParserException(
                `Could not parse tool calling content: ${toolCallingContent}. Error: ${e}`
            )
        }
    }

    /**
     * Returns the format instructions as a string.
     * @param options Options for getting the format instructions.
     * @returns Format instructions as a string.
     */
    getFormatInstructions(): string {
        return renderTemplate(FORMAT_INSTRUCTIONS, 'f-string', {
            tool_names: this.toolNames.join(', ')
        })
    }
}

// Keep the old class name for backward compatibility but make it use the new multi-action parser
export class ReActSingleInputOutputParser extends ReActMultiInputOutputParser {
    constructor(fields: { toolNames: string[] }) {
        super(fields)
    }
}
