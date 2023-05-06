import { VectorStoreRetriever } from 'langchain/dist/vectorstores/base';
import { ChatPromptTemplate } from 'langchain/dist/prompts/chat';
import { LLMChain } from 'langchain';
import { Tool } from "langchain/dist/tools/base";
import {
    AIChatMessage,
    BaseChatMessage,
    HumanChatMessage,
    SystemChatMessage,
} from "langchain/dist/schema";
import { ObjectTool } from './base';
import { ChatHubToolOutputParser } from './out_parsers';
import { TokenTextSplitter } from 'langchain/dist/text_splitter';
import { getEmbeddingContextSize, getModelContextSize } from 'langchain/dist/base_language/count_tokens';
import { BaseChatModel } from 'langchain/dist/chat_models/base';

export interface ChatChainToolInput {
    botName: string;
    systemPrompts?: ChatPromptTemplate
    memory?: VectorStoreRetriever;
    humanInTheLoop?: boolean;
    outputParser?: ChatHubToolOutputParser;
    // 给模型思考的轮数
    maxIterations?: number;
}

// https://github.com/hwchase17/langchainjs/blob/7c59816b8fc34b026cd4436ac259c0b8e8ef351f/langchain/src/experimental/autogpt/agent.ts

export class ChatHubToolChain {
    botName: string;

    memory: VectorStoreRetriever;

    fullMessageHistory: BaseChatMessage[];

    nextActionCount: number;

    chain: LLMChain;

    outputParser: ChatHubToolOutputParser

    tools: ObjectTool[];

    feedbackTool?: Tool;

    maxIterations: number;

    // Currently not generic enough to support any text splitter.
    textSplitter: TokenTextSplitter;

    constructor({
        botName,
        memory,
        chain,
        outputParser,
        tools,
        feedbackTool,
        maxIterations,
    }: ChatChainToolInput & {
        chain: LLMChain;
        tools: ObjectTool[];
        feedbackTool?: Tool;
    }) {

        this.botName = botName;
        this.memory = memory;
        this.fullMessageHistory = [];
        this.nextActionCount = 0;
        this.chain = chain;
        this.outputParser = outputParser;
        this.tools = tools;
        this.feedbackTool = feedbackTool;
        this.maxIterations = maxIterations;
        const chunkSize = getEmbeddingContextSize(
            "modelName" in memory.vectorStore.embeddings
                ? (memory.vectorStore.embeddings.modelName as string)
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
            systemPrompts,
            memory,
            maxIterations = 2,
            // humanInTheLoop = false,
            outputParser = new ChatHubToolOutputParser(),
        }: ChatChainToolInput
    ): ChatHubToolChain {
        const prompt = new AutoGPTPrompt({
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
        return new ChatHubToolChain({
            botName,
            memory,
            chain,
            outputParser,
            tools,
            // feedbackTool,
            maxIterations,
        });
    }

}