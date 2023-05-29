import { LLMChain } from 'langchain/chains';
import { BaseChatModel } from 'langchain/chat_models/base';
import { HumanChatMessage, AIChatMessage, ChainValues } from 'langchain/schema';
import { BufferMemory, ConversationSummaryMemory } from "langchain/memory";
import { ChatHubChain, SystemPrompts } from './base';
import { Tool } from 'langchain/tools';
import { AgentExecutor, initializeAgentExecutorWithOptions } from "langchain/agents";
import { ChatHubBaseChatModel } from '../model/base';


export interface ChatHubPluginChainInput {
    systemPrompts?: SystemPrompts
    historyMemory: ConversationSummaryMemory | BufferMemory
}

export class ChatHubPluginChain extends ChatHubChain
    implements ChatHubPluginChainInput {


    executor: AgentExecutor

    historyMemory: ConversationSummaryMemory | BufferMemory

    systemPrompts?: SystemPrompts;

    constructor({
        historyMemory,
        systemPrompts,
        executor,
    }: ChatHubPluginChainInput & {
        executor: AgentExecutor;
    }) {
        super();

        this.historyMemory = historyMemory;
        this.systemPrompts = systemPrompts;
        this.executor = executor;
    }

    static async fromLLMAndTools(
        llm: ChatHubBaseChatModel,
        tools: Tool[],
        {
            historyMemory,
            systemPrompts
        }: ChatHubPluginChainInput
    ): Promise<ChatHubPluginChain> {

        if (systemPrompts?.length > 1) {
            console.warn("Plugin chain does not support multiple system prompts. Only the first one will be used.")
        }

        const executor = await initializeAgentExecutorWithOptions(tools, llm, {
            verbose: true,
            agentType: "chat-conversational-react-description",
            agentArgs: {
                systemMessage: systemPrompts?.[0].text
            }
        });

        return new ChatHubPluginChain({
            executor,
            historyMemory,
            systemPrompts,
        });

    }

    async call(message: HumanChatMessage): Promise<ChainValues> {
        const requests: ChainValues = {
            input: message.text
        }
        const chatHistory = await this.historyMemory.loadMemoryVariables(requests)


        requests["chat_history"] = chatHistory[this.historyMemory.memoryKey]

        const response = await this.executor.call(requests);

        const responseString = response.output

        await this.historyMemory.saveContext(
            { input: message.text },
            { output: responseString }
        )

        const aiMessage = new AIChatMessage(responseString);
        response.message = aiMessage

        return response


    }




}