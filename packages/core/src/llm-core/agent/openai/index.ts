import {
    AIMessage,
    BaseMessage,
    FunctionMessage,
    SystemMessage,
    ToolMessage
} from '@langchain/core/messages'
import { ChainValues } from '@langchain/core/utils/types'
import {
    FunctionsAgentAction,
    OpenAIFunctionsAgentOutputParser,
    OpenAIToolsAgentOutputParser,
    ToolsAgentAction
} from './output_parser'
import {
    Agent,
    AgentAction,
    AgentArgs,
    AgentFinish,
    AgentInput,
    AgentStep
} from 'langchain/agents'
import { CallbackManager } from '@langchain/core/callbacks/manager'
import { LLMChain } from 'langchain/chains'
import { BaseLanguageModel } from '@langchain/core/language_models/base'
import {
    BasePromptTemplate,
    ChatPromptTemplate,
    HumanMessagePromptTemplate,
    MessagesPlaceholder,
    SystemMessagePromptTemplate
} from '@langchain/core/prompts'
import { StructuredTool } from '@langchain/core/tools'
import { PREFIX } from './prompt'
import { ChatLunaChatModel } from '../../platform/model'
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
    observation: string
) {
    if (isToolsAgentAction(action) && action.toolCallId !== undefined) {
        const log = action.messageLog as BaseMessage[]
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
            new FunctionMessage(observation, action.tool)
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
 * Interface for the input data required to create an OpenAIAgent.
 */
export interface OpenAIAgentInput extends AgentInput {
    tools: StructuredTool[]
}

/**
 * Interface for the arguments required to create a prompt for an
 * OpenAIAgent.
 */
export interface OpenAIAgentCreatePromptArgs {
    prefix?: string
    systemMessage?: SystemMessage
}

/**
 * Class representing an agent for the OpenAI chat model in LangChain. It
 * extends the Agent class and provides additional functionality specific
 * to the OpenAIAgent type.
 *
 * @deprecated Use the bew RunnableSequence
 */
export class OpenAIAgent extends Agent {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    static lc_name() {
        return 'OpenAIAgent'
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_namespace = ['@langchain/core/messages', 'agents', 'openai']

    _agentType() {
        return 'openai-functions' as const
    }

    observationPrefix() {
        return 'Observation: '
    }

    llmPrefix() {
        return 'Thought:'
    }

    _stop(): string[] {
        return ['Observation:']
    }

    tools: StructuredTool[]

    outputParser:
        | OpenAIToolsAgentOutputParser
        | OpenAIFunctionsAgentOutputParser
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        | any = new OpenAIFunctionsAgentOutputParser()

    constructor(input: Omit<OpenAIAgentInput, 'outputParser'>) {
        super({ ...input, outputParser: undefined })
        this.tools = input.tools
    }

    /**
     * Creates a prompt for the OpenAIAgent using the provided tools and
     * fields.
     * @param _tools The tools to be used in the prompt.
     * @param fields Optional fields for creating the prompt.
     * @returns A BasePromptTemplate object representing the created prompt.
     */
    static createPrompt(
        _tools: StructuredTool[],
        fields?: OpenAIAgentCreatePromptArgs
    ): BasePromptTemplate {
        const { prefix = PREFIX } = fields || {}
        return ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(prefix),
            new MessagesPlaceholder('chat_history'),
            HumanMessagePromptTemplate.fromTemplate('{input}'),
            new MessagesPlaceholder('agent_scratchpad')
        ])
    }

    /**
     * Creates an OpenAIAgent from a BaseLanguageModel and a list of tools.
     * @param llm The BaseLanguageModel to use.
     * @param tools The tools to be used by the agent.
     * @param args Optional arguments for creating the agent.
     * @returns An instance of OpenAIAgent.
     */
    static fromLLMAndTools(
        llm: BaseLanguageModel,
        tools: StructuredTool[],
        args?: OpenAIAgentCreatePromptArgs & Pick<AgentArgs, 'callbacks'>
    ) {
        OpenAIAgent.validateTools(tools)
        /*  if (
            llm._modelType() !== 'base_chat_model' ||
            llm._llmType() !== 'openai'
        ) {
            throw new Error('OpenAIAgent requires an OpenAI chat model')
        } */
        const prompt = OpenAIAgent.createPrompt(tools, args)
        const chain = new LLMChain({
            prompt,
            llm,
            callbacks: args?.callbacks
        })
        return new OpenAIAgent({
            llmChain: chain,
            allowedTools: tools.map((t) => t.name),
            tools
        })
    }

    /**
     * Constructs a scratch pad from a list of agent steps.
     * @param steps The steps to include in the scratch pad.
     * @returns A string or a list of BaseMessages representing the constructed scratch pad.
     */
    async constructScratchPad(
        steps: AgentStep[]
    ): Promise<string | BaseMessage[]> {
        return _formatIntermediateSteps(steps)
    }

    /**
     * Plans the next action or finish state of the agent based on the
     * provided steps, inputs, and optional callback manager.
     * @param steps The steps to consider in planning.
     * @param inputs The inputs to consider in planning.
     * @param callbackManager Optional CallbackManager to use in planning.
     * @returns A Promise that resolves to an AgentAction or AgentFinish object representing the planned action or finish state.
     */
    async plan(
        steps: AgentStep[],
        inputs: ChainValues,
        callbackManager?: CallbackManager
    ): Promise<AgentAction | AgentFinish> {
        // Add scratchpad and stop to inputs
        const thoughts = await this.constructScratchPad(steps)
        const newInputs: ChainValues = {
            ...inputs,
            agent_scratchpad: thoughts
        }
        if (this._stop().length !== 0) {
            newInputs.stop = this._stop()
        }

        // Split inputs between prompt and llm
        const llm = this.llmChain.llm as ChatLunaChatModel
        const valuesForPrompt = { ...newInputs }
        const valuesForLLM: (typeof llm)['CallOptions'] = {
            tools: this.tools
        }
        const callKeys =
            'callKeys' in this.llmChain.llm ? this.llmChain.llm.callKeys : []
        for (const key of callKeys) {
            if (key in inputs) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                valuesForLLM[key as keyof (typeof llm)['CallOptions'] as any] =
                    inputs[key]
                delete valuesForPrompt[key]
            }
        }

        const promptValue =
            await this.llmChain.prompt.formatPromptValue(valuesForPrompt)
        const message = await llm.predictMessages(
            promptValue.toChatMessages(),
            valuesForLLM,
            callbackManager
        )
        if (
            message.additional_kwargs.tool_calls &&
            this.outputParser instanceof OpenAIFunctionsAgentOutputParser
        ) {
            this.outputParser = new OpenAIToolsAgentOutputParser()
        } else if (
            message.additional_kwargs.function_call &&
            this.outputParser instanceof OpenAIToolsAgentOutputParser
        ) {
            this.outputParser = new OpenAIFunctionsAgentOutputParser()
        }
        return this.outputParser.parseAIMessage(message)
    }
}
