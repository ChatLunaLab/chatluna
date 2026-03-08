import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    isBaseMessage
} from '@langchain/core/messages'
import { ChatGeneration } from '@langchain/core/outputs'
import { AgentStep } from '@langchain/core/agents'
import {
    BaseOutputParser,
    OutputParserException
} from '@langchain/core/output_parsers'
import {
    AgentAction,
    AgentFinish,
    ChatCompletionMessageFunctionCall,
    ChatCompletionMessageToolCall
} from '../types'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'

/**
 * Type that represents an agent action with an optional message log.
 */
export type FunctionsAgentAction = AgentAction & {
    messageLog?: BaseMessage[]
}

export class OpenAIFunctionsAgentOutputParser extends BaseOutputParser<
    AgentAction | AgentFinish
> {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_namespace = ['@langchain/core/messages', 'agents', 'openai']

    // eslint-disable-next-line @typescript-eslint/naming-convention
    static lc_name() {
        return 'OpenAIFunctionsAgentOutputParser'
    }

    async parse(text: string): Promise<AgentAction | AgentFinish> {
        throw new Error(
            `OpenAIFunctionsAgentOutputParser can only parse messages.\nPassed input: ${text}`
        )
    }

    async parseResult(generations: ChatGeneration[]) {
        if (
            'message' in generations[0] &&
            isBaseMessage(generations[0].message)
        ) {
            return this.parseAIMessage(generations[0].message)
        }
        throw new Error(
            'parseResult on OpenAIFunctionsAgentOutputParser only works on ChatGeneration output'
        )
    }

    /**
     * Parses the output message into a FunctionsAgentAction or AgentFinish
     * object.
     * @param message The BaseMessage to parse.
     * @returns A FunctionsAgentAction or AgentFinish object.
     */
    parseAIMessage(message: BaseMessage): FunctionsAgentAction | AgentFinish {
        if (message.content && typeof message.content !== 'string') {
            throw new Error(
                'This agent cannot parse non-string model responses.'
            )
        }

        // eslint-disable-next-line prefer-destructuring, @typescript-eslint/naming-convention
        const function_call: ChatCompletionMessageFunctionCall =
            message.additional_kwargs.function_call

        if (!function_call) {
            return {
                returnValues: { output: message.content, message },
                log: message.content as string
            }
        }

        try {
            const toolInput = function_call.arguments
                ? JSON.parse(function_call.arguments)
                : {}
            const content = getMessageContent(message.content)
            return {
                tool: function_call.name,
                toolInput,
                log:
                    content?.length > 0
                        ? content
                        : `Invoking "${function_call.name}" with ${function_call.arguments ?? '{}'}`,
                messageLog: [message],
                content: message.content
            }
        } catch (error) {
            throw new OutputParserException(
                `Failed to parse function arguments from chat model response. Text: "${function_call.arguments}". ${error}`
            )
        }
    }

    getFormatInstructions(): string {
        throw new Error(
            'getFormatInstructions not implemented inside OpenAIFunctionsAgentOutputParser.'
        )
    }
}

/**
 * Type that represents an agent action with an optional message log.
 */
export type ToolsAgentAction = AgentAction & {
    toolCallId: string
    messageLog?: BaseMessage[]
}

export type ToolsAgentStep = AgentStep & {
    action: ToolsAgentAction
}

export class OpenAIToolsAgentOutputParser extends BaseOutputParser<
    AgentAction[] | AgentFinish
> {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_namespace = ['@langchain/core/messages', 'agents', 'openai']

    // eslint-disable-next-line @typescript-eslint/naming-convention
    static lc_name() {
        return 'OpenAIToolsAgentOutputParser'
    }

    async parse(text: string): Promise<AgentAction[] | AgentFinish> {
        throw new Error(
            `OpenAIFunctionsAgentOutputParser can only parse messages.\nPassed input: ${text}`
        )
    }

    async parseResult(generations: ChatGeneration[]) {
        if (
            'message' in generations[0] &&
            isBaseMessage(generations[0].message)
        ) {
            return this.parseAIMessage(generations[0].message)
        }
        throw new Error(
            'parseResult on OpenAIFunctionsAgentOutputParser only works on ChatGeneration output'
        )
    }

    /**
     * Parses the output message into a ToolsAgentAction[] or AgentFinish
     * object.
     * @param message The BaseMessage to parse.
     * @returns A ToolsAgentAction[] or AgentFinish object.
     */
    parseAIMessage(message: BaseMessage): ToolsAgentAction[] | AgentFinish {
        const agentFinish: AgentFinish = {
            returnValues: { output: message.content },
            log: message.content as string
        }

        const content = getMessageContent(message.content)
        const { tool_calls: rawToolCalls } = message.additional_kwargs
        if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
            const toolCalls = rawToolCalls as ChatCompletionMessageToolCall[]
            try {
                return toolCalls.map((toolCall, i) => {
                    return {
                        tool: toolCall.function.name,
                        toolInput: toolCall.function.arguments
                            ? JSON.parse(toolCall.function.arguments)
                            : {},
                        toolCallId: toolCall.id,
                        log:
                            content?.length > 0
                                ? content
                                : `Invoking "${toolCall.function.name}" with ${toolCall.function.arguments ?? '{}'}`,
                        messageLog: i === 0 ? [message] : [],
                        content: message.content
                    }
                })
            } catch (error) {
                throw new OutputParserException(
                    `Failed to parse tool arguments from chat model response. Text: "${JSON.stringify(toolCalls)}". ${error}`
                )
            }
        }

        if (
            (message instanceof AIMessageChunk ||
                message instanceof AIMessage) &&
            message.tool_calls?.length > 0
        ) {
            const { tool_calls: toolCalls } = message
            try {
                return toolCalls.map((toolCall, i) => {
                    return {
                        tool: toolCall.name,
                        toolInput: toolCall.args,
                        toolCallId: toolCall.id,
                        log:
                            content?.length > 0
                                ? content
                                : `Invoking "${toolCall.name}" with ${JSON.stringify(toolCall.args) ?? '{}'}`,
                        messageLog: i === 0 ? [message] : [],
                        content: message.content
                    }
                })
            } catch (error) {
                throw new OutputParserException(
                    `Failed to parse tool arguments from chat model response. Text: "${JSON.stringify(toolCalls)}". ${error}`
                )
            }
        }

        return agentFinish
    }

    getFormatInstructions(): string {
        throw new Error(
            'getFormatInstructions not implemented inside OpenAIToolsAgentOutputParser.'
        )
    }
}
