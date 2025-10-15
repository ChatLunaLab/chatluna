import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    FunctionMessage,
    MessageContent,
    ToolMessage
} from '@langchain/core/messages'
import { BaseOutputParser } from '@langchain/core/output_parsers'
import {
    RunnableLambda,
    RunnablePassthrough,
    RunnableSequence
} from '@langchain/core/runnables'
import { StructuredTool } from '@langchain/core/tools'
import { AgentAction, AgentFinish, AgentStep } from '@langchain/core/agents'
import type { ChatLunaChatModel } from '../../platform/model'
import {
    FunctionsAgentAction,
    OpenAIFunctionsAgentOutputParser,
    OpenAIToolsAgentOutputParser,
    ToolsAgentAction
} from './output_parser'
import { BaseChatPromptTemplate } from '@langchain/core/prompts'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'

/**
 * Checks if the given action is a FunctionsAgentAction.
 * @param action The action to check.
 * @returns True if the action is a FunctionsAgentAction, false otherwise.
 */
function isFunctionsAgentAction(
    action: AgentAction | FunctionsAgentAction
): action is FunctionsAgentAction {
    return (action as FunctionsAgentAction).messageLog !== undefined
}

function isToolsAgentAction(
    action: AgentAction | ToolsAgentAction
): action is ToolsAgentAction {
    return (action as ToolsAgentAction).toolCallId !== undefined
}

// eslint-disable-next-line @typescript-eslint/naming-convention
function _convertAgentStepToMessages(
    action: AgentAction | FunctionsAgentAction | ToolsAgentAction,
    observation: MessageContent
) {
    if (isToolsAgentAction(action) && action.toolCallId !== undefined) {
        const log = action.messageLog as BaseMessage[]
        if (
            observation.length < 1 ||
            observation == null ||
            observation === 'null'
        ) {
            observation = `The tool ${action.tool} returned no output. Try again or stop the tool call, tell the user failed to execute the tool.`
        }
        return log.concat(
            new ToolMessage({
                content: observation,
                name: action.tool,
                tool_call_id: action.toolCallId
            })
        )
    } else if (
        isFunctionsAgentAction(action) &&
        action.messageLog !== undefined
    ) {
        return action.messageLog?.concat(
            new FunctionMessage(getMessageContent(observation), action.tool)
        )
    } else {
        return [new AIMessage(action.log)]
    }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export function _formatIntermediateSteps(
    intermediateSteps: AgentStep[]
): BaseMessage[] {
    return intermediateSteps.flatMap(({ action, observation }) =>
        _convertAgentStepToMessages(action, observation)
    )
}

/**
 * Params used by the createOpenAIFunctionsAgent function.
 */
export type CreateOpenAIAgentParams = {
    /**
     * LLM to use as the agent. Should work with OpenAI function calling,
     * so must either be an OpenAI model that supports that or a wrapper of
     * a different model that adds in equivalent support.
     */
    llm: ChatLunaChatModel
    /** Tools this agent has access to. */
    tools: StructuredTool[]
    /** The prompt to use, must have an input key for `agent_scratchpad`. */
    prompt: BaseChatPromptTemplate
}

export function createOpenAIAgent({
    llm,
    tools,
    prompt
}: CreateOpenAIAgentParams) {
    const llmWithTools = llm.withConfig({
        tools
    })

    let outputParser: BaseOutputParser<
        AgentAction[] | AgentFinish | AgentAction
    > = new OpenAIToolsAgentOutputParser()

    const agent = RunnableSequence.from([
        RunnablePassthrough.assign({
            // eslint-disable-next-line @typescript-eslint/naming-convention
            agent_scratchpad: (input: { steps: AgentStep[] }) =>
                _formatIntermediateSteps(input.steps)
            /* // @ts-expect-error eslint-disable-next-line @typescript-eslint/naming-convention
            input_text: (input: { input: BaseMessage[] }) =>
                getMessageContent(input.input[0].content) */
        }),
        prompt,
        llmWithTools,
        RunnableLambda.from((input: BaseMessage) => {
            if (
                ((input?.additional_kwargs?.tool_calls &&
                    input?.additional_kwargs?.tool_calls.length > 0) ||
                    ((input instanceof AIMessageChunk ||
                        input instanceof AIMessage) &&
                        input.tool_calls &&
                        input.tool_calls.length > 0)) &&
                outputParser instanceof OpenAIFunctionsAgentOutputParser
            ) {
                outputParser = new OpenAIToolsAgentOutputParser()
            } else if (
                input?.additional_kwargs?.function_call &&
                outputParser instanceof OpenAIToolsAgentOutputParser
            ) {
                outputParser = new OpenAIFunctionsAgentOutputParser()
            }

            if (input == null) {
                return [
                    {
                        tool: '_Exception',
                        toolInput: 'Something unknown error. Please try again.',
                        log: 'Input is null'
                    }
                ]
            }

            return outputParser.parseResult([
                {
                    message: input,
                    text: getMessageContent(input.content)
                }
            ])
        })
    ])

    return agent
}
