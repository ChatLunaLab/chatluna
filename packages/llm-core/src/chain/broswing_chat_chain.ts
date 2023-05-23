import { LLMChain } from 'langchain';
import { BaseChatModel } from 'langchain/chat_models/base';
import { HumanChatMessage, AIChatMessage, BaseChatMessageHistory, ChainValues, SystemChatMessage } from 'langchain/schema';
import { BufferMemory, ConversationSummaryMemory } from "langchain/memory";
import { VectorStoreRetrieverMemory } from 'langchain/memory';
import { ChatHubChain, ObjectTool, SystemPrompts } from './base';
import { AIMessagePromptTemplate, ChatPromptTemplate, HumanMessagePromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate } from 'langchain/prompts';
import { VectorStoreRetriever } from 'langchain/vectorstores/base';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { FakeEmbeddings } from 'langchain/embeddings/fake';
import { BaseMessageStringPromptTemplate, ChatPromptValue } from 'langchain/dist/prompts/chat';
import { calculateMaxTokens, getEmbeddingContextSize, getModelContextSize } from '../utils/count_tokens';
import { ChatHubBroswingPrompt, ChatHubChatPrompt } from './prompt';
import { Embeddings } from 'langchain/embeddings/base';
import { ChatHubBrowsingAction, ChatHubBrowsingActionOutputParser } from './out_parsers';
import { TokenTextSplitter } from 'langchain/text_splitter';


export interface ChatHubBrowsingChainInput {
    botName: string;
    systemPrompts?: SystemPrompts
    embeddings: Embeddings

    historyMemory: ConversationSummaryMemory | BufferMemory
}

export class ChatHubBrowsingChain extends ChatHubChain
    implements ChatHubBrowsingChainInput {
    botName: string;

    embeddings: Embeddings;

    searchMemory: VectorStoreRetrieverMemory

    chain: LLMChain;

    historyMemory: ConversationSummaryMemory | BufferMemory

    systemPrompts?: SystemPrompts;

    _outputParser: ChatHubBrowsingActionOutputParser

    // Currently not generic enough to support any text splitter.
    textSplitter: TokenTextSplitter;

    tools: ObjectTool[];

    constructor({
        botName,
        embeddings,
        historyMemory,
        systemPrompts,
        chain,
        tools
    }: ChatHubBrowsingChainInput & {
        chain: LLMChain;
        tools: ObjectTool[];
    }) {
        super();
        this.botName = botName;

        this.embeddings = embeddings

        // use memory 
        this.searchMemory = new VectorStoreRetrieverMemory({
            vectorStoreRetriever: (new MemoryVectorStore(embeddings).asRetriever(6)),
            memoryKey: "long_history",
            inputKey: "input",
            outputKey: "result",
            returnDocs: true
        });
        this.historyMemory = historyMemory;
        this.systemPrompts = systemPrompts;
        this.chain = chain;
        this.tools = tools
        this._outputParser = new ChatHubBrowsingActionOutputParser()
        const chunkSize = getEmbeddingContextSize(
            "modelName" in this.searchMemory.vectorStoreRetriever.vectorStore.embeddings
                ? (this.searchMemory.vectorStoreRetriever.vectorStore.embeddings.modelName as string)
                : undefined
        );
        this.textSplitter = new TokenTextSplitter({
            chunkSize,
            chunkOverlap: Math.round(chunkSize / 10),
        });

        if (this.systemPrompts?.length > 1) {
            console.warn("Browsing chain does not support multiple system prompts. Only the first one will be used.")
        }
    }

    static fromLLMAndTools(
        llm: BaseChatModel,
        tools: ObjectTool[],
        {
            botName,
            embeddings,
            historyMemory,
            systemPrompts,

        }: ChatHubBrowsingChainInput
    ): ChatHubBrowsingChain {

        const humanMessagePromptTemplate = HumanMessagePromptTemplate.fromTemplate("{input}")

        let conversationSummaryPrompt: SystemMessagePromptTemplate
        let messagesPlaceholder: MessagesPlaceholder

        if (historyMemory instanceof ConversationSummaryMemory) {
            conversationSummaryPrompt = SystemMessagePromptTemplate.fromTemplate(`This is some conversation between me and you. Please generate an response based on the system prompt and content below.Current conversation: {chat_history}`)
        } else {
            messagesPlaceholder = new MessagesPlaceholder("chat_history")
        }
        const prompt = new ChatHubBroswingPrompt({
            systemPrompt: systemPrompts[0] ?? new SystemChatMessage("You are ChatGPT, a large language model trained by OpenAI. Carefully heed the user's instructions."),
            conversationSummaryPrompt: conversationSummaryPrompt,
            messagesPlaceholder: messagesPlaceholder,
            tokenCounter: (text) => llm.getNumTokens(text),
            humanMessagePromptTemplate: humanMessagePromptTemplate,
            sendTokenLimit: getModelContextSize(llm._modelType() ?? "gpt2"),
        })

        const chain = new LLMChain({ llm, prompt });

        return new ChatHubBrowsingChain({
            botName,
            embeddings,
            historyMemory,
            systemPrompts,
            chain,
            tools
        });
    }


    private _selectTool(action: ChatHubBrowsingAction): ObjectTool {
        if (action.name === "search") {
            return this.tools.find((tool) => tool.name.toLowerCase().includes("search"))!;
        } else if (action.name === "browse") {
            return this.tools.find((tool) => tool.name === "web-browser")!;
        }

    }

    async call(message: HumanChatMessage): Promise<ChainValues> {
        const requests: ChainValues = {
            input: message.text
        }
        const chatHistory = await this.historyMemory.loadMemoryVariables(requests)

        requests["chat_history"] = chatHistory[this.historyMemory.memoryKey]

        let finalResponse: string

        let loopCount = 0;

        let browsingCache: string[] = []
        while (true) {
            if (loopCount > 10) {

                const { text: assistantReply } = await this.chain.call({
                    ...requests,
                    browsing: ["You called tool more than 10 counts. Your must generate response to the user by yourself."]
                });


                // Print the assistant reply
                // TODO: Use koishi‘s logger
                console.info(assistantReply);


                const action = await this._outputParser.parse(assistantReply);

                if (action.name === "chat") {
                    finalResponse = action.args.response;
                    break
                } else {
                    finalResponse = "The LLM chain has been called tool more than 10 counts. Break the loop."
                }

                break
            }

            const { text: assistantReply } = await this.chain.call({
                ...requests,
                browsing: browsingCache
            });

            // Print the assistant reply
            // TODO: Use koishi‘s logger
            console.info(assistantReply);


            const action = await this._outputParser.parse(assistantReply);

            if (action.name === "chat") {
                finalResponse = action.args.response;
                break
            }

            let result = ''
            if (action.name == "search" || action.name == "browse") {
                const tool = this._selectTool(action)
                let observation: string
                try {
                    observation = await tool.call(action.args);
                } catch (e) {
                    observation = `Error in args: ${e}`;
                }
                result = `Tool ${tool.name} returned: ${observation}`;
            } else if (action.name === "ERROR") {
                result = `Error: ${action.args}. `;
            } else {
                result = `Unknown Tool '${action.name}'.`;
            }

            let memoryToAdd = `Calling Tool: ${assistantReply}\nResult: ${result} `;

            browsingCache.push(memoryToAdd)

        }

        await this.historyMemory.saveContext(
            { input: message.text },
            { output: finalResponse }
        )

        const aiMessage = new AIChatMessage(finalResponse);

        return {
            message: aiMessage,
        }
    }




}