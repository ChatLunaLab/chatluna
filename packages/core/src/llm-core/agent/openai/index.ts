import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    FunctionMessage,
    HumanMessage,
    ToolMessage
} from '@langchain/core/messages'
import { BaseOutputParser } from '@langchain/core/output_parsers'
import {
    RunnableLambda,
    RunnablePassthrough,
    RunnableSequence
} from '@langchain/core/runnables'
import { StructuredTool } from '@langchain/core/tools'
import {
    AgentAction,
    AgentFinish,
    AgentObservation,
    AgentStep,
    ScratchpadEntry
} from '../types'
import type { ChatLunaChatModel } from '../../platform/model'
import {
    FunctionsAgentAction,
    OpenAIFunctionsAgentOutputParser,
    OpenAIToolsAgentOutputParser,
    ToolsAgentAction
} from './output_parser'
import { BaseChatPromptTemplate } from '@langchain/core/prompts'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { observationToMessageContent } from '../tool-observation'

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
    observation: AgentObservation
) {
    if (isToolsAgentAction(action) && action.toolCallId !== undefined) {
        const log = action.messageLog as BaseMessage[]
        const content = observationToMessageContent(observation)
        if (
            content === observation &&
            (content.length < 1 || content === 'null')
        ) {
            return log.concat(
                new ToolMessage({
                    content:
                        `The tool '${action.tool}' returned no output. ` +
                        'Do not call this tool with the exact same input ' +
                        'again. Change strategy, use different arguments, ' +
                        'or finish with a blocker summary.',
                    name: action.tool,
                    tool_call_id: action.toolCallId
                })
            )
        }
        return log.concat(
            new ToolMessage({
                content,
                name: action.tool,
                tool_call_id: action.toolCallId
            })
        )
    } else if (
        isFunctionsAgentAction(action) &&
        action.messageLog !== undefined
    ) {
        return action.messageLog?.concat(
            new FunctionMessage(
                getMessageContent(observation as BaseMessage['content']),
                action.tool
            )
        )
    } else {
        const content = observationToMessageContent(observation)
        return [
            new AIMessage(
                `${action.log}\n<tool_calling>${JSON.stringify([
                    { name: action.tool, arguments: action.toolInput }
                ])}</tool_calling>`
            ),
            new HumanMessage({
                content:
                    typeof content === 'string'
                        ? `Observation: ${content}`
                        : [{ type: 'text', text: 'Observation: ' }, ...content],
                name: action.tool
            })
        ]
    }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export function _formatIntermediateSteps(
    intermediateSteps: ScratchpadEntry[]
): BaseMessage[] {
    const messages: BaseMessage[] = []
    const seen = new Set<BaseMessage>()
    const seenIds = new Set<string>()
    for (const step of intermediateSteps) {
        const batch =
            'messages' in step
                ? step.messages
                : _convertAgentStepToMessages(step.action, step.observation)
        for (const message of batch) {
            if (seen.has(message) || (message.id && seenIds.has(message.id))) {
                continue
            }
            seen.add(message)
            if (message.id) seenIds.add(message.id)
            messages.push(message)
        }
    }
    return messages
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
            agent_scratchpad: (input: {
                steps: AgentStep[]
                scratchpadEntries?: ScratchpadEntry[]
                configurable?: { context?: unknown }
            }) =>
                input.configurable?.context
                    ? []
                    : _formatIntermediateSteps(
                          input.scratchpadEntries ?? input.steps
                      )
        }),
        prompt,
        llmWithTools,
        RunnableLambda.from((input: BaseMessage) => {
            if (input == null) {
                return [
                    {
                        tool: '_Exception',
                        toolInput: 'Something unknown error. Please try again.',
                        log: 'Input is null'
                    }
                ]
            }

            const hasTools =
                input.additional_kwargs?.tool_calls?.length > 0 ||
                ((input instanceof AIMessageChunk ||
                    input instanceof AIMessage) &&
                    input.tool_calls?.length > 0)
            const hasFunction = input.additional_kwargs?.function_call != null

            if (
                hasTools &&
                outputParser instanceof OpenAIFunctionsAgentOutputParser
            ) {
                outputParser = new OpenAIToolsAgentOutputParser()
            } else if (
                hasFunction &&
                outputParser instanceof OpenAIToolsAgentOutputParser
            ) {
                outputParser = new OpenAIFunctionsAgentOutputParser()
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
