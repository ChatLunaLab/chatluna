import {
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    FunctionMessage,
    HumanMessage,
    MessageContentComplex,
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
            new FunctionMessage(
                getMessageContent(observation as BaseMessage['content']),
                action.tool
            )
        )
    } else {
        return [new AIMessage(action.log)]
    }
}

function mergeHumanMessages(messages: HumanMessage[]) {
    if (messages.length === 1) {
        return messages[0]
    }

    const base = messages[0]
    const content: MessageContentComplex[] = []

    for (const msg of messages) {
        if (content.length > 0) {
            content.push({ type: 'text', text: '\n' })
        }

        if (typeof msg.content === 'string') {
            content.push({ type: 'text', text: msg.content })
            continue
        }

        content.push(...msg.content)
    }

    return new HumanMessage({
        content,
        name: base.name,
        id: base.id,
        additional_kwargs: messages.reduce(
            (acc, msg) => Object.assign(acc, msg.additional_kwargs),
            Object.assign({}, base.additional_kwargs)
        )
    })
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export function _formatIntermediateSteps(
    intermediateSteps: ScratchpadEntry[]
): BaseMessage[] {
    return intermediateSteps.flatMap((step) => {
        if ('messages' in step) {
            return step.messages.length > 0
                ? [mergeHumanMessages(step.messages)]
                : []
        }

        return _convertAgentStepToMessages(step.action, step.observation)
    })
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
            }) =>
                _formatIntermediateSteps(input.scratchpadEntries ?? input.steps)
            /* // @ts-expect-error eslint-disable-next-line @typescript-eslint/naming-convention
            input_text: (input: { input: BaseMessage[] }) =>
                getMessageContent(input.input[0].content) */
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
