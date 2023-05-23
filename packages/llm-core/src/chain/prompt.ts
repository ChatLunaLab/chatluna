import { BaseChatPromptTemplate, BasePromptTemplate, ChatPromptTemplate, HumanMessagePromptTemplate, MessagesPlaceholder, SerializedBasePromptTemplate, SystemMessagePromptTemplate } from 'langchain/prompts';
import { ObjectTool, SystemPrompts } from './base';
import { Document } from 'langchain/document';
import { BaseChatMessage, SystemChatMessage, HumanChatMessage, PartialValues, MessageType, AIChatMessage } from 'langchain/schema';
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
        let systemMessageIndex: number = 0
        let systemMessageCopy: BaseChatMessage


        for (const message of this.systemPrompts || []) {
            let messageTokens = await this._countMessageTokens(message)

            // always add the system prompts
            result.push(message)
            usedTokens += messageTokens
            if (!systemMessageCopy) {
                systemMessageIndex += 1
            }

            if (message._getType() === "system" && !systemMessageCopy) {
                systemMessageCopy = new SystemChatMessage(message.text)
            }
        }

        const inputTokens = await this.tokenCounter(input)

        usedTokens += inputTokens


        let formatConversationSummary: SystemChatMessage
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

            formatConversationSummary = await this.conversationSummaryPrompt.format({
                long_history: formatDocuents.map((document) => document.pageContent).join(" "),
                chat_history: chat_history
            })


        } else {
            const formatChatHistory: BaseChatMessage[] = []

            for (const message of (<BaseChatMessage[]>chat_history).reverse()) {

                let messageTokens = await this._countMessageTokens(message)

                // reserve 400 tokens for the long history
                if (usedTokens + messageTokens > this.sendTokenLimit - (
                    long_history.length > 0 ? 480 : 80
                )) {
                    break
                }

                usedTokens += messageTokens
                formatChatHistory.unshift(message)
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

            formatConversationSummary = await this.conversationSummaryPrompt.format({
                long_history: formatDocuents.map((document) => document.pageContent).join(" "),
            })


            const formatMessagesPlaceholder = await this.messagesPlaceholder.formatMessages({
                chat_history: formatChatHistory
            })

            result.push(...formatMessagesPlaceholder)

        }

        // result.splice(systemMessageIndex, 0, systemMessageCopy)

        //  result.push(formatConversationSummary)

        const formatInput = new HumanChatMessage(input + "\n\n" + formatConversationSummary.text)

        result.push(formatInput)

        console.info(`Used tokens: ${usedTokens} exceed limit: ${this.sendTokenLimit}`)

        console.info(`messages: ${JSON.stringify(result)}`)

        return result

    }

    async partial(_values: PartialValues): Promise<BasePromptTemplate> {
        throw new Error("Method not implemented.");
    }

    serialize(): SerializedBasePromptTemplate {
        throw new Error("Method not implemented.");
    }

}

export interface ChatHubBroswingPromptInput {
    systemPrompt: BaseChatMessage
    conversationSummaryPrompt?: SystemMessagePromptTemplate,
    messagesPlaceholder?: MessagesPlaceholder,
    tokenCounter: (text: string) => Promise<number>;
    humanMessagePromptTemplate?: HumanMessagePromptTemplate;
    sendTokenLimit?: number;
}


export class ChatHubBroswingPrompt
    extends BaseChatPromptTemplate
    implements ChatHubBroswingPromptInput {


    systemPrompt: BaseChatMessage;

    tokenCounter: (text: string) => Promise<number>;

    messagesPlaceholder?: MessagesPlaceholder;

    humanMessagePromptTemplate: HumanMessagePromptTemplate;

    conversationSummaryPrompt?: SystemMessagePromptTemplate;

    sendTokenLimit?: number;

    constructor(fields: ChatHubBroswingPromptInput) {
        super({ inputVariables: ["chat_history", "input", "browsing"] });

        this.systemPrompt = fields.systemPrompt;
        this.tokenCounter = fields.tokenCounter;

        this.messagesPlaceholder = fields.messagesPlaceholder;
        this.conversationSummaryPrompt = fields.conversationSummaryPrompt;
        this.humanMessagePromptTemplate = fields.humanMessagePromptTemplate ?? HumanMessagePromptTemplate.fromTemplate("{input}");
        this.sendTokenLimit = fields.sendTokenLimit ?? 4096;
    }

    _getPromptType() {
        return "chathub_browsing" as const;
    }


    private async _countMessageTokens(message: BaseChatMessage) {
        let result = await this.tokenCounter(message.text) + await this.tokenCounter(messageTypeToOpenAIRole(message._getType()))

        if (message.name) {
            result += await this.tokenCounter(message.name)
        }

        return result
    }

    private _constructFullSystemPrompt() {
        return `You can currently call the following tools to assist you in obtaining content. You must choose to call each tool selectively during every chat, and only one tool can be called each chat. You can call these tools either on your own or based on the content of the user. The return values of the call must be self-analyzed. You can only call these tools no more than five times each, and after that, you must generate content to return to the user. You need to call these tools in json format, and in the future, only output content in json format. After calling the tool, the user will return the value of the call. You can only communicate with me by calling tools. Please directly use the json format to call the tools, do not add the prefix 'your:', and do not add any other text. Your response must be able to be parsed as json, remember!
        Here are the tools you can use:
        search: Searching for content on the internet will return an array of links, titles, and descriptions, args: "keyword": "Search keyword"
        browse: Returns the summary of the linked URL by task, possibly including a webpage summary, HTML text, etc.,args: {"url":"Target link","task":"what you want to find on the page or empty string for a summary"}
        chat: Generate content for user. When you only need to generate content and don't need to call other tools, please call this tool.,args: "response": "Generated content"
        Here is example:
        user: Hello
        your: {"name":"chat","args":{"response":"Hello"}}
        user: Do you know about the recent news about openai?
        your: {"name":"search","args":{"keyword":"openai news recent"}}
        You can only communicate with me by calling tools. Please directly use the json format to call the tools, do not add the prefix 'your:', and do not add any other text. **Your response must be able to be parsed as json, remember!** Please use other tools based on user input, and only call the chat tool if none of the other tools are suitable.
        Next, please follow the requirements above and enter the following preset: ` + this.systemPrompt.text
    }


    async formatMessages({
        chat_history,
        input,
        browsing
    }: {
        input: string;
        chat_history: BaseChatMessage[] | string
        browsing: string[];
    }) {
        const result: BaseChatMessage[] = []

        result.push(new SystemChatMessage(this._constructFullSystemPrompt()))

        let usedTokens = await this._countMessageTokens(result[0])
        const inputTokens = await this.tokenCounter(input)

        usedTokens += inputTokens


        let formatConversationSummary: SystemChatMessage
        if (!this.messagesPlaceholder) {

            const chatHistoryTokens = await this.tokenCounter(chat_history as string)

            if (usedTokens + chatHistoryTokens > this.sendTokenLimit) {
                console.error(`Used tokens: ${usedTokens + chatHistoryTokens} exceed limit: ${this.sendTokenLimit}`)
            }

            // splice the chat history
            chat_history = chat_history.slice(-chat_history.length * 0.6)


            formatConversationSummary = await this.conversationSummaryPrompt.format({
                chat_history: chat_history
            })

            result.push(formatConversationSummary)

        } else {
            const formatChatHistory: BaseChatMessage[] = []

            for (const message of (<BaseChatMessage[]>chat_history).slice(-10).reverse()) {

                let messageTokens = await this._countMessageTokens(message)

                // reserve 400 tokens for the long history
                if (usedTokens + messageTokens > this.sendTokenLimit - 1000
                ) {
                    break
                }

                usedTokens += messageTokens
                formatChatHistory.unshift(message)
            }

            const formatMessagesPlaceholder = await this.messagesPlaceholder.formatMessages({
                chat_history: formatChatHistory
            })

            result.push(...formatMessagesPlaceholder)

        }


        for (let i = 0; i < browsing.length; i++) {
            const sub = browsing[i]

            const usedToken = await this.tokenCounter(sub)

            if (usedTokens + usedToken > this.sendTokenLimit - 100) {
                browsing.splice(i, browsing.length - i)
                break
            }

            usedTokens += usedToken
        }

        // result.splice(systemMessageIndex, 0, systemMessageCopy)

        //  result.push(formatConversationSummary)

        if (browsing.length > 0) {
            result.push(new SystemChatMessage(`Call tools: ${browsing.join("\n")}`))
        }
        const formatInput = new HumanChatMessage(input)

        result.push(formatInput)

        console.info(`Used tokens: ${usedTokens} exceed limit: ${this.sendTokenLimit}`)

        console.info(`messages: ${JSON.stringify(result)}`)

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