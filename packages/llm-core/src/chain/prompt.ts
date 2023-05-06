import { BaseChatPromptTemplate, BasePromptTemplate, ChatPromptTemplate, SerializedBasePromptTemplate } from 'langchain/dist/prompts';
import { ObjectTool, SystemPrompts } from './base';
import { BaseChatMessage, SystemChatMessage, HumanChatMessage, PartialValues } from 'langchain/dist/schema';
import { VectorStoreRetriever } from 'langchain/dist/vectorstores/base';
import { generateSearchAndChatPrompt } from './prompt_generator';

export interface ChatHubSearchAndChatPromptInput {
    botName: string;
    systemPrompts?: SystemPrompts
    tools: ObjectTool[];
    tokenCounter: (text: string) => Promise<number>;
    sendTokenLimit?: number;
}


export class ChatHubSearchAndChatPrompt
    extends BaseChatPromptTemplate
    implements ChatHubSearchAndChatPromptInput {

    botName: string;
    systemPrompts?: SystemPrompts;
    tools: ObjectTool[];
    tokenCounter: (text: string) => Promise<number>;
    sendTokenLimit?: number;

    constructor(fields: ChatHubSearchAndChatPromptInput) {
        super({ inputVariables: ["memory", "messages", "chat_content"] });

        this.botName = fields.botName;
        this.systemPrompts = fields.systemPrompts;
        this.tools = fields.tools;
        this.tokenCounter = fields.tokenCounter;
        this.sendTokenLimit = fields.sendTokenLimit;
    }

    _getPromptType() {
        return "chathub_tool" as const;
    }

    constructFullPrompt(): string {
        const promptStart = `Your decisions must always be made independently.
        without seeking user assistance. Play to your strengths 
        as an LLM and pursue simple strategies with no legal complications. 
        You can only perform a maximum of two rounds of tasks, and after more than two rounds you must summarize the output to the user based on the previous content.`.trim();


        return promptStart + `\n\n${generateSearchAndChatPrompt(this.tools)}`;
    }

    async formatMessages({
        memory,
        messages: previousMessages,
        user_input,
    }: {
        goals: string[];
        memory: VectorStoreRetriever;
        messages: BaseChatMessage[];
        user_input: string;
    }) {
        const basePrompt = new SystemChatMessage(this.constructFullPrompt());
        const timePrompt = new SystemChatMessage(
            `The current time and date is ${new Date().toLocaleString()}`
        );
        const usedTokens =
            (await this.tokenCounter(basePrompt.text)) +
            (await this.tokenCounter(timePrompt.text));
        const relevantDocs = await memory.getRelevantDocuments(
            JSON.stringify(previousMessages.slice(-10))
        );
        const relevantMemory = relevantDocs.map((d) => d.pageContent);
        let relevantMemoryTokens = await relevantMemory.reduce(
            async (acc, doc) => (await acc) + (await this.tokenCounter(doc)),
            Promise.resolve(0)
        );

        while (usedTokens + relevantMemoryTokens > 2500) {
            relevantMemory.pop();
            relevantMemoryTokens = await relevantMemory.reduce(
                async (acc, doc) => (await acc) + (await this.tokenCounter(doc)),
                Promise.resolve(0)
            );
        }

        const contentFormat = `This reminds you of these events from your past:\n${relevantMemory.join(
            "\n"
        )}\n\n`;
        const memoryMessage = new SystemChatMessage(contentFormat);
        const usedTokensWithMemory =
            (usedTokens) + (await this.tokenCounter(memoryMessage.text));
        const historicalMessages: BaseChatMessage[] = [];

        for (const message of previousMessages.slice(-10).reverse()) {
            const messageTokens = await this.tokenCounter(message.text);
            if (usedTokensWithMemory + messageTokens > this.sendTokenLimit - 1000) {
                break;
            }
            historicalMessages.unshift(message);
        }

        const inputMessage = new HumanChatMessage(user_input);
        const messages: BaseChatMessage[] = [
            basePrompt,
            ...(this.systemPrompts || []),
            timePrompt,
            memoryMessage,
            ...historicalMessages,
            inputMessage,
        ];
        return messages;
    }

    async partial(_values: PartialValues): Promise<BasePromptTemplate> {
        throw new Error("Method not implemented.");
    }

    serialize(): SerializedBasePromptTemplate {
        throw new Error("Method not implemented.");
    }
}