import { LLMChain } from 'langchain';
import { BaseChatModel } from 'langchain/dist/chat_models/base';
import { FINISH_NAME } from 'langchain/dist/experimental/autogpt/schema';
import { BaseChatMessage, HumanChatMessage, AIChatMessage, SystemChatMessage, BaseChatMessageHistory, ChainValues } from 'langchain/dist/schema';
import { Tool } from 'langchain/dist/tools/base';
import { VectorStoreRetriever } from 'langchain/dist/vectorstores/base';
import { ChatHubChain, ObjectTool, SystemPrompts } from './base';
import { ChatHubChainActionOutputParser } from './out_parsers';
import { TokenTextSplitter } from 'langchain/dist/text_splitter';
import {
    getEmbeddingContextSize,
    getModelContextSize,
} from "langchain/dist/base_language/count_tokens.js";
import { ChatHubSearchAndChatPrompt } from './prompt';
import { VectorStoreRetrieverMemory } from 'langchain/dist/memory/vector_store';



export interface ChatHubSearchAndChatChainInput {
    botName: string;
    systemPrompts?: SystemPrompts
    memory: VectorStoreRetrieverMemory;
    outputParser: ChatHubChainActionOutputParser
    history?: BaseChatMessageHistory
}

export class ChatHubSearchAndChatChain extends ChatHubChain
    implements ChatHubSearchAndChatChainInput {
    botName: string;

    memory: VectorStoreRetrieverMemory;

    fullMessageHistory: BaseChatMessage[];

    chain: LLMChain;

    outputParser: ChatHubChainActionOutputParser;

    tools: ObjectTool[];

    // Currently not generic enough to support any text splitter.
    textSplitter: TokenTextSplitter;


    _history: BaseChatMessageHistory;

    constructor({
        botName,
        memory,
        chain,
        tools,
        history,
        outputParser,
    }: ChatHubSearchAndChatChainInput & {
        chain: LLMChain;
        tools: ObjectTool[];
        feedbackTool?: Tool;
    }) {
        super();
        this.botName = botName;
        this.memory = memory;
        this.chain = chain;
        this.outputParser = outputParser;
        this.tools = tools;
        this._history = history;

        setTimeout(async () => {
            this.fullMessageHistory = (await this._history.getMessages()) || [];
        }, 0)

        const chunkSize = getEmbeddingContextSize(
            "modelName" in memory.vectorStoreRetriever.vectorStore.embeddings
                ? (memory.vectorStoreRetriever.vectorStore.embeddings.modelName as string)
                : undefined
        );
        this.textSplitter = new TokenTextSplitter({
            chunkSize,
            chunkOverlap: Math.round(chunkSize / 10),
        });
    }

    static fromLLMAndTools(
        llm: BaseChatModel,
        tools: ObjectTool[],
        {
            botName,
            memory,
            systemPrompts,
            history,
            outputParser = new ChatHubChainActionOutputParser(),
        }: ChatHubSearchAndChatChainInput
    ): ChatHubSearchAndChatChain {
        const prompt = new ChatHubSearchAndChatPrompt({
            botName,
            systemPrompts,
            tools,
            tokenCounter: llm.getNumTokens.bind(llm),
            sendTokenLimit: getModelContextSize(
                "modelName" in llm ? (llm.modelName as string) : "gpt2"
            ),
        });
        // const feedbackTool = humanInTheLoop ? new HumanInputRun() : null;
        const chain = new LLMChain({ llm, prompt });
        return new ChatHubSearchAndChatChain({
            botName,
            memory,
            history,
            chain,
            outputParser,
            tools,
        });
    }

    async call(message: HumanChatMessage): Promise<ChainValues> {

        let loopCount = 0;
        // like new bing, only 2 iterations

        let modelRespose: string

        const text = message.text + "\nBased on use response,determine which next command to use, and respond using the format specified above:"

        while (loopCount < 2) {

            loopCount += 1;

            const { text: assistantReply } = await this.chain.call({
                text: text,
                memory: this.memory.vectorStoreRetriever,
                messages: this.fullMessageHistory,
            });

            // Print the assistant reply
            // TODO: Use koishi‘s logger
            console.log(assistantReply);

            this.fullMessageHistory.push(new HumanChatMessage(text));
            this.fullMessageHistory.push(new AIChatMessage(assistantReply));

            const action = await this.outputParser.parse(assistantReply);
            const tools = this.tools.reduce(
                (acc, tool) => ({ ...acc, [tool.name]: tool }),
                {} as { [key: string]: ObjectTool }
            );
            if (action.name === FINISH_NAME) {
                modelRespose = action.args.response;
                break
            }
            let result: string;

            if (action.name in tools) {
                const tool = tools[action.name];
                let observation: string
                try {
                    observation = await tool.call(action.args);
                } catch (e) {
                    observation = `Error in args: ${e}`;
                }
                result = `Command ${tool.name} returned: ${observation}`;
            } else if (action.name === "ERROR") {
                result = `Error: ${action.args}. `;
            } else {
                result = `Unknown command '${action.name}'. Please refer to the 'COMMANDS' list for available commands and only respond in the specified JSON format.`;
            }

            let memoryToAdd = `Assistant Reply: ${assistantReply}\nResult: ${result} `;

            const documents = await this.textSplitter.createDocuments([memoryToAdd]);
            await this.memory.vectorStoreRetriever.addDocuments(documents);
            this.fullMessageHistory.push(new SystemChatMessage(result));

        }

        // When storing history messages, the content at the time of execution chain is discarded
        this._history?.addUserMessage(message.text)

        this._history?.addAIChatMessage(modelRespose)

        return {
            message: new AIChatMessage(modelRespose),
        }
    }


}