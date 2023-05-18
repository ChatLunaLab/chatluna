import { BaseChatPromptTemplate, BasePromptTemplate, ChatPromptTemplate, HumanMessagePromptTemplate, MessagesPlaceholder, SerializedBasePromptTemplate, SystemMessagePromptTemplate } from 'langchain/prompts';
import { ObjectTool, SystemPrompts } from './base';
import { Document } from 'langchain/document';
import { BaseChatMessage, SystemChatMessage, HumanChatMessage, PartialValues, MessageType } from 'langchain/schema';
import { VectorStoreRetriever } from 'langchain/vectorstores/base';
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


export interface ChatHubChatPromptInput {
    systemPrompts?: SystemPrompts
    conversationSummaryPrompt: SystemMessagePromptTemplate,
    messagesPlaceholder?: MessagesPlaceholder,
    tokenCounter: (text: string) => Promise<number>;
    humanMessagePromptTemplate?: HumanMessagePromptTemplate;
    sendTokenLimit?: number;
}



export class ChatHubChatPrompt
    extends BaseChatPromptTemplate
    implements ChatHubChatPromptInput {


    systemPrompts?: SystemPrompts;

    tokenCounter: (text: string) => Promise<number>;

    messagesPlaceholder?: MessagesPlaceholder;

    humanMessagePromptTemplate: HumanMessagePromptTemplate;

    conversationSummaryPrompt: SystemMessagePromptTemplate;

    sendTokenLimit?: number;

    constructor(fields: ChatHubChatPromptInput) {
        super({ inputVariables: ["chat_history", "long_history", "input"] });


        this.systemPrompts = fields.systemPrompts;
        this.tokenCounter = fields.tokenCounter;

        this.messagesPlaceholder = fields.messagesPlaceholder;
        this.conversationSummaryPrompt = fields.conversationSummaryPrompt;
        this.humanMessagePromptTemplate = fields.humanMessagePromptTemplate ?? HumanMessagePromptTemplate.fromTemplate("{input}");
        this.sendTokenLimit = fields.sendTokenLimit ?? 4096;
    }

    _getPromptType() {
        return "chathub_chat" as const;
    }


    private async _countMessageTokens(message: BaseChatMessage) {
        let result = await this.tokenCounter(message.text) + await this.tokenCounter(messageTypeToOpenAIRole(message._getType()))

        if (message.name) {
            result += await this.tokenCounter(message.name)
        }

        return result
    }


    async formatMessages({
        chat_history,
        long_history,
        input,
    }: {
        input: string;
        chat_history: BaseChatMessage[] | string
        long_history: Document[];
    }) {
        const result: BaseChatMessage[] = []
        let usedTokens = 0

        for (const message of this.systemPrompts || []) {
            let messageTokens = await this._countMessageTokens(message)

            // always add the system prompts
            result.push(message)
            usedTokens += messageTokens
        }

        const inputTokens = await this.tokenCounter(input)

        usedTokens += inputTokens

        if (!this.messagesPlaceholder) {

            const chatHistoryTokens = await this.tokenCounter(chat_history as string)

            if (usedTokens + chatHistoryTokens > this.sendTokenLimit) {
                console.error(`Used tokens: ${usedTokens + chatHistoryTokens} exceed limit: ${this.sendTokenLimit}`)
            }

            // splice the chat history
            chat_history = chat_history.slice(-chat_history.length * 0.6)

            const formatDocuents: Document[] = []
            for (const document of long_history) {
                const documentTokens = await this.tokenCounter(document.pageContent)

                // reserve 80 tokens for the format
                if (usedTokens + documentTokens > this.sendTokenLimit - 80) {
                    break
                }

                usedTokens += documentTokens
                formatDocuents.push(document)
            }

            const formatConversationSummary = await this.conversationSummaryPrompt.format({
                long_history: formatDocuents,
                chat_history: chat_history
            })

            result.push(formatConversationSummary)
        } else {
            const formatChatHistory: BaseChatMessage[] = []

            for (const message of (<BaseChatMessage[]>chat_history).reverse()) {

                let messageTokens = await this._countMessageTokens(message)

                // reserve 300 tokens for the long history
                if (usedTokens + messageTokens > this.sendTokenLimit - (
                    long_history.length > 0 ? 300 : 80
                )) {
                    break
                }

                usedTokens += messageTokens
                formatChatHistory.push(message)
            }

            const formatDocuents: Document[] = []
            for (const document of long_history) {
                const documentTokens = await this.tokenCounter(document.pageContent)

                // reserve 80 tokens for the format
                if (usedTokens + documentTokens > this.sendTokenLimit - 80) {
                    break
                }

                usedTokens += documentTokens
                formatDocuents.push(document)
            }

            const formatConversationSummary = await this.conversationSummaryPrompt.format({
                long_history: formatDocuents,
            })

            result.push(formatConversationSummary)

            const formatMessagesPlaceholder = await this.messagesPlaceholder.formatMessages({
                chat_history: formatChatHistory
            })

            result.push(...formatMessagesPlaceholder)

        }

        const formatInput = new HumanChatMessage(input)

        result.push(formatInput)

        return result

    }

    async partial(_values: PartialValues): Promise<BasePromptTemplate> {
        throw new Error("Method not implemented.");
    }

    serialize(): SerializedBasePromptTemplate {
        throw new Error("Method not implemented.");
    }

}

function messageTypeToOpenAIRole(
    type: MessageType
): string {
    switch (type) {
        case "system":
            return "system";
        case "ai":
            return "assistant";
        case "human":
            return "user";
        default:
            throw new Error(`Unknown message type: ${type}`);
    }
}