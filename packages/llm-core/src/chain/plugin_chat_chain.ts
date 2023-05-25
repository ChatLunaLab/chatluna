import { LLMChain } from 'langchain/chains';
import { BaseChatModel } from 'langchain/chat_models/base';
import { HumanChatMessage, AIChatMessage, ChainValues } from 'langchain/schema';
import { BufferMemory, ConversationSummaryMemory } from "langchain/memory";
import { ChatHubChain, SystemPrompts } from './base';
import { Tool, StructuredTool } from 'langchain/tools';
import { initializeAgentExecutorWithOptions } from "langchain/agents";


export interface ChatHubPluginChainInput {

    systemPrompts?: SystemPrompts
    humanMessagePrompt?: string
    historyMemory: ConversationSummaryMemory | BufferMemory
}

export class ChatHubPluginChain extends ChatHubChain
    implements ChatHubPluginChainInput {


    chain: LLMChain;

    historyMemory: ConversationSummaryMemory | BufferMemory

    systemPrompts?: SystemPrompts;

    constructor({
        historyMemory,
        systemPrompts,
        chain,
    }: ChatHubPluginChainInput & {
        chain: LLMChain;
    }) {
        super();

        this.historyMemory = historyMemory;
        this.systemPrompts = systemPrompts;
        this.chain = chain;
    }

    static async fromLLMAndTools(
        llm: BaseChatModel,
        tools: StructuredTool[],
        {
            historyMemory,
            systemPrompts,
            humanMessagePrompt,
        }: ChatHubPluginChainInput
    ): Promise<ChatHubPluginChain> {

        /*  if (systemPrompts?.length > 1) {
             console.warn("Plugin chain does not support multiple system prompts. Only the first one will be used.")
         }
 
         const executor = await initializeAgentExecutorWithOptions(tools, llm, {
             agentType: "chat-conversational-react-description"
         }); */

        throw new Error("Not implemented")

    }

    async call(message: HumanChatMessage): Promise<ChainValues> {
        /*  const requests: ChainValues = {
             input: message.text
         }
         const chatHistory = await this.historyMemory.loadMemoryVariables(requests)
         const longHistory = await this.longMemory.loadMemoryVariables({
             user: message.text
         })
 
         requests["chat_history"] = chatHistory[this.historyMemory.memoryKey]
         requests["long_history"] = longHistory[this.longMemory.memoryKey]
 
         const response = await this.chain.call(requests);
 
         const responseString = response[this.chain.outputKey] */

        /* await this.historyMemory.chatHistory.addUserMessage(message.text)

        await this.historyMemory.chatHistory.addAIChatMessage(responseString) */

        /*  await this.longMemory.saveContext(
             { user: message.text },
             { your: responseString }
         )
 
         await this.historyMemory.saveContext(
             { input: message.text },
             { output: responseString }
         )
 
         const aiMessage = new AIChatMessage(responseString);
         response.message = aiMessage
 
         return response */

        throw new Error("Not implemented")
    }




}