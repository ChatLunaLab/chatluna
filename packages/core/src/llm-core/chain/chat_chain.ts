import { LLMChain } from 'langchain/chains';
import { BaseChatModel } from 'langchain/chat_models/base';
import { HumanMessage, AIMessage, BaseChatMessageHistory, ChainValues, SystemMessage } from 'langchain/schema';
import { BufferMemory, ConversationSummaryMemory } from "langchain/memory";
import { VectorStoreRetrieverMemory } from 'langchain/memory';
import { ChatHubChain, ChatHubChatModelChain, SystemPrompts } from './base';
import { AIMessagePromptTemplate, ChatPromptTemplate, HumanMessagePromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate } from 'langchain/prompts';
import { VectorStoreRetriever } from 'langchain/vectorstores/base';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { FakeEmbeddings } from 'langchain/embeddings/fake';
import { BaseMessageStringPromptTemplate, ChatPromptValue } from 'langchain/dist/prompts/chat';
import { calculateMaxTokens, getModelContextSize } from '../utils/count_tokens';
import { ChatHubChatPrompt } from './prompt';
import { ChatHubBaseChatModel, ChatHubSaveableVectorStore } from '../model/base';
import { createLogger } from '../utils/logger';

const logger = createLogger("@dingyi222666/chathub/llm-core/chain/function_calling_browsing_chain")

export interface ChatHubChatChainInput {
    botName: string;
    systemPrompts?: SystemPrompts
    longMemory?: VectorStoreRetrieverMemory;
    humanMessagePrompt?: string
    historyMemory: ConversationSummaryMemory | BufferMemory
}

export class ChatHubChatChain extends ChatHubChain
    implements ChatHubChatChainInput {
    botName: string;

    longMemory: VectorStoreRetrieverMemory;

    chain: ChatHubChatModelChain;

    historyMemory: ConversationSummaryMemory | BufferMemory

    systemPrompts?: SystemPrompts;

    constructor({
        botName,
        longMemory,
        historyMemory,
        systemPrompts,
        chain,
    }: ChatHubChatChainInput & {
        chain: ChatHubChatModelChain;
    }) {
        super();
        this.botName = botName;

        // roll back to the empty memory if not set
        this.longMemory = longMemory ?? new VectorStoreRetrieverMemory({
            vectorStoreRetriever: (new MemoryVectorStore(new FakeEmbeddings()).asRetriever(6)),
            memoryKey: "long_history",
            inputKey: "user",
            outputKey: "your",
            returnDocs: true
        });
        this.historyMemory = historyMemory;
        this.systemPrompts = systemPrompts;
        this.chain = chain;
    }

    static fromLLM(
        llm: ChatHubBaseChatModel,
        {
            botName,
            longMemory,
            historyMemory,
            systemPrompts,
            humanMessagePrompt,
        }: ChatHubChatChainInput
    ): ChatHubChain {

        let humanMessagePromptTemplate = HumanMessagePromptTemplate.fromTemplate(humanMessagePrompt ?? "{input}")

        let conversationSummaryPrompt: SystemMessagePromptTemplate
        let messagesPlaceholder: MessagesPlaceholder

        if (historyMemory instanceof ConversationSummaryMemory) {
            conversationSummaryPrompt = SystemMessagePromptTemplate.fromTemplate(`This is some conversation between me and you. Please generate an response based on the system prompt and content below. Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant, and based on these information, generate similar but non-repetitive responses. Pay attention, you need to think more and diverge your creativity) Current conversation: {chat_history}`)
        } else {
            conversationSummaryPrompt = SystemMessagePromptTemplate.fromTemplate(`Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant, and based on these information, generate similar but non-repetitive responses. Pay attention, you need to think more and diverge your creativity.)`)

            messagesPlaceholder = new MessagesPlaceholder("chat_history")

        }
        const prompt = new ChatHubChatPrompt({
            systemPrompts: systemPrompts ?? [new SystemMessage("You are ChatGPT, a large language model trained by OpenAI. Carefully heed the user's instructions.")],
            conversationSummaryPrompt: conversationSummaryPrompt,
            messagesPlaceholder: messagesPlaceholder,
            tokenCounter: (text) => llm.getNumTokens(text),
            humanMessagePromptTemplate: humanMessagePromptTemplate,
            sendTokenLimit: llm.getModelMaxContextSize()
        })

        const chain = new ChatHubChatModelChain({ llm, prompt });

        return new ChatHubChatChain({
            botName,
            longMemory,
            historyMemory,
            systemPrompts,
            chain,
        });
    }

    async call(message: HumanMessage): Promise<ChainValues> {
        const requests: ChainValues = {
            input: message.content
        }
        const chatHistory = await this.historyMemory.loadMemoryVariables(requests)

        const longHistory = await this.longMemory.loadMemoryVariables({
            user: message.content
        })

        requests["chat_history"] = chatHistory[this.historyMemory.memoryKey]
        requests["long_history"] = longHistory[this.longMemory.memoryKey]

        const response = await this.chain.call(requests);

        if (response.text == null) {
            throw new Error("response.text is null")
        }

        const responseString = response.text

        await this.longMemory.saveContext(
            { user: message.content },
            { your: responseString }
        )

        await this.historyMemory.saveContext(
            { input: message.content },
            { output: responseString }
        )

        const vectorStore = this.longMemory.vectorStoreRetriever.vectorStore

        if (vectorStore instanceof ChatHubSaveableVectorStore) {
            logger.debug("saving vector store")
            await vectorStore.save()
        }

        const aiMessage = new AIMessage(responseString);
        response.message = aiMessage

        if (response.extra != null && "additionalReplyMessages" in response.extra) {
            response.additionalReplyMessages = response.extra.additionalReplyMessages
        }

        return response
    }




}