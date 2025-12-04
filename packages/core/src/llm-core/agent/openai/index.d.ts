import { BaseMessage } from '@langchain/core/messages'
import { RunnableSequence } from '@langchain/core/runnables'
import { StructuredTool } from '@langchain/core/tools'
import { AgentAction, AgentFinish, AgentStep } from '@langchain/core/agents'
import type { ChatLunaChatModel } from '../../platform/model'
import { BaseChatPromptTemplate } from '@langchain/core/prompts'
export declare function _formatIntermediateSteps(
    intermediateSteps: AgentStep[]
): BaseMessage[]
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
export declare function createOpenAIAgent({
    llm,
    tools,
    prompt
}: CreateOpenAIAgentParams): RunnableSequence<
    {
        steps: AgentStep[]
    },
    AgentAction | AgentFinish | AgentAction[]
>
