import { LLMChain } from 'langchain';
import { BaseChatModel } from 'langchain/dist/chat_models/base';
import { HumanChatMessage, AIChatMessage, BaseChatMessageHistory, ChainValues } from 'langchain/dist/schema';
import { BufferMemory, ConversationSummaryMemory } from "langchain/dist/memory";
import { VectorStoreRetrieverMemory } from 'langchain/dist/memory/vector_store';
import { ChatHubChain, SystemPrompts } from './base';
import { AIMessagePromptTemplate, ChatPromptTemplate, HumanMessagePromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate } from 'langchain/dist/prompts';
import { BaseMessagePromptTemplate } from 'langchain/dist/prompts/chat';
import { VectorStoreRetriever } from 'langchain/dist/vectorstores/base';
import { MemoryVectorStore } from 'langchain/dist/vectorstores/memory';
import { FakeEmbeddings } from 'langchain/dist/embeddings/fake';


export interface ChatHubChatChainInput {
    botName: string;
    systemPrompts?: SystemPrompts
    longMemory?: VectorStoreRetrieverMemory;

    historyMemory: ConversationSummaryMemory | BufferMemory
}

export class ChatHubChatChain extends ChatHubChain
    implements ChatHubChatChainInput {
    botName: string;

    longMemory: VectorStoreRetrieverMemory;

    chain: LLMChain;

    historyMemory: ConversationSummaryMemory | BufferMemory

    systemPrompts?: SystemPrompts;

    constructor({
        botName,
        longMemory,
        historyMemory,
        systemPrompts,
    }: ChatHubChatChainInput & {
        chain: LLMChain;
    }) {
        super();
        this.botName = botName;

        // roll back to the empty memory if not set
        this.longMemory = longMemory ?? new VectorStoreRetrieverMemory({
            vectorStoreRetriever: new VectorStoreRetriever({
                vectorStore: new MemoryVectorStore(new FakeEmbeddings())
            })
        });
        this.historyMemory = historyMemory;
        this.systemPrompts = systemPrompts;
    }

    static fromLLM(
        llm: BaseChatModel,
        {
            botName,
            longMemory,
            historyMemory,
            systemPrompts,
        }: ChatHubChatChainInput
    ): ChatHubChatChain {
        // if not set the system prompts, use the default prompts
        const targetSystemPrompts = systemPrompts?.map((message) => {
            if (message._getType() == "ai") {
                return AIMessagePromptTemplate.fromTemplate(message.text)
            } else if (message._getType() == "system") {
                return SystemMessagePromptTemplate.fromTemplate(message.text)
            } else if (message._getType() == "human") {
                return HumanMessagePromptTemplate.fromTemplate(message.text)
            }
        }) ?? [SystemMessagePromptTemplate.fromTemplate("You are ChatGPT, a large language model trained by OpenAI.Carefully heed the user's instructions.")]

        let promptMessages: (BaseMessagePromptTemplate | ChatPromptTemplate)[] = [
            ...targetSystemPrompts,
            HumanMessagePromptTemplate.fromTemplate("{input}"),
        ]

        const targetInsertedPosition = (() => {
            // if promptMessages.length == 2, the inserted position is 1

            if (promptMessages.length == 2) {
                return 1
            }

            // find the prev system message

            for (let i = promptMessages.length - 1; i >= 0; i--) {
                if (promptMessages[i] instanceof SystemMessagePromptTemplate) {
                    return i + 1
                }
            }
        })()

        let conversationSummaryPrompt: SystemMessagePromptTemplate

        if (historyMemory instanceof ConversationSummaryMemory) {
            conversationSummaryPrompt = SystemMessagePromptTemplate.fromTemplate(`This is a conversation between me and you. Please generate a response based on the system prompt and content below.
            Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant)
            Current conversation:
            {chat_history}`)

            // push the conversation summary prompt to the prompt messages
            promptMessages = promptMessages.splice(targetInsertedPosition, 0, conversationSummaryPrompt)
        } else {
            conversationSummaryPrompt = SystemMessagePromptTemplate.fromTemplate(`This is a conversation between me and you. Please generate a response based on the system prompt and content below.
            Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant)`)

            // push the conversation summary prompt to the prompt messages
            promptMessages = promptMessages.splice(targetInsertedPosition, 0, conversationSummaryPrompt)

            const messagesPlaceholder = new MessagesPlaceholder("chat_history")

            // insert after the conversation summary prompt

            promptMessages = promptMessages.splice(targetInsertedPosition + 1, 0, messagesPlaceholder)
        }

        const prompt = ChatPromptTemplate.fromPromptMessages(promptMessages);

        const chain = new LLMChain({ llm, prompt });

        return new ChatHubChatChain({
            botName,
            longMemory,
            historyMemory,
            systemPrompts,
            chain,
        });
    }

    async call(message: HumanChatMessage): Promise<ChainValues> {
        const requests: Record<string, any> = {
            input: message.text,
        }
        const chatHistory = await this.historyMemory.loadMemoryVariables(requests)
        const longHistory = await this.longMemory.loadMemoryVariables(requests)

        requests["chat_history"] = chatHistory[this.historyMemory.memoryKey]
        requests["long_history"] = longHistory[this.longMemory.memoryKey]

        const response = await this.chain.call(requests);

        const responseString = response[this.chain.outputKey]

        await this.historyMemory.chatHistory.addAIChatMessage(responseString)

        const aiMessage = new AIChatMessage(responseString);
        response.message = aiMessage

        return response
    }




}