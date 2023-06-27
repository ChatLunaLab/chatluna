import { BaseChatPromptTemplate, BasePromptTemplate, ChatPromptTemplate, HumanMessagePromptTemplate, MessagesPlaceholder, SerializedBasePromptTemplate, SystemMessagePromptTemplate } from 'langchain/prompts';
import { ObjectTool, SystemPrompts } from './base';
import { Document } from 'langchain/document';
import { BaseChatMessage, SystemChatMessage, HumanChatMessage, PartialValues, MessageType, AIChatMessage, FunctionChatMessage } from 'langchain/schema';
import { createLogger } from '../utils/logger';

const logger = createLogger("@dingyi222666/chathub/llm-core/chain/prompt")

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


        let formatConversationSummary: SystemChatMessage | null
        if (!this.messagesPlaceholder) {

            const chatHistoryTokens = await this.tokenCounter(chat_history as string)

            if (usedTokens + chatHistoryTokens > this.sendTokenLimit) {
                logger.warn(`Used tokens: ${usedTokens + chatHistoryTokens} exceed limit: ${this.sendTokenLimit}. Is too long history. Splitting the history.`)
            }

            // splice the chat history
            chat_history = chat_history.slice(-chat_history.length * 0.6)

            if (long_history.length > 0) {

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
            }


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

            if (long_history.length > 0) {

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
            }


            const formatMessagesPlaceholder = await this.messagesPlaceholder.formatMessages({
                chat_history: formatChatHistory
            })

            result.push(...formatMessagesPlaceholder)

        }

        if (formatConversationSummary) {
            result.push(formatConversationSummary)
        }

        const formatInput = new HumanChatMessage(input)

        result.push(formatInput)

        logger.debug(`Used tokens: ${usedTokens} exceed limit: ${this.sendTokenLimit}`)

        logger.debug(`messages: ${JSON.stringify(result)}`)

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
    conversationSummaryPrompt: SystemMessagePromptTemplate,
    messagesPlaceholder?: MessagesPlaceholder,
    tokenCounter: (text: string) => Promise<number>;
    humanMessagePromptTemplate?: HumanMessagePromptTemplate;
    sendTokenLimit?: number;
}

export interface ChatHubOpenAIFunctionCallPromptInput {
    systemPrompts?: SystemPrompts
    conversationSummaryPrompt: SystemMessagePromptTemplate,
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

    conversationSummaryPrompt: SystemMessagePromptTemplate;

    sendTokenLimit?: number;

    constructor(fields: ChatHubBroswingPromptInput) {
        super({ inputVariables: ["chat_history", "input"] });

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
        return `Constraints: 
        1. Always, you must call tools to chat with user by yourself.
        2. Always get information from the Internet before answering user questions, and use your own existing knowledge when you can’t get it.
        3. You can only call one tool at a time. 
        4. Before calling the chat tool, you must call the search or browse tool to get the latest information about events related to the user's chat.
        5. Always call the chat tool when you have finished all your objectives.
        
        Tools:
        1. search: A search engine. useful for when you need to answer questions about current events, will return an array of links, titles, and descriptions, args: {"keyword": "Search keywords, you should cut what you are searching for into several keywords and separate them with spaces. For example, 'What is the weather in Beijing today?' would be 'Beijing weather today'"}
        2. browse: Useful for when you need to find something on or summarize a webpage., possibly including a webpage summary, HTML text, etc.,args: {"url":"Target link","task":"what you want to find on the page or empty string for a summary"}
        3. chat: Generate content to user. When you need to generate content of finished all your objectives, please call this tool.,args: {"response": "Generated content"}
        
        Resources:
        1. Internet access for searches and information gathering.
        
        Performance Evaluation:
        1. Continuously review and analyze your actions to ensure you are performing to the best of your abilities. 
        2. Constructively self-criticize your big-picture behavior constantly. 
        3. Reflect on past decisions and strategies to refine your approach. 
        4. Every tool has a cost, so be smart and efficient. Aim to complete tasks in the least number of steps.
        5. If you are not sure what to do, you can call the chat tool to ask the user for help.
        
        Preset: 
        ` + this.systemPrompt.text + `

        Respone:
        You should only respond in JSON format as described below.

        Response Format:
        
        {"name":"tool name","args":{"arg name":"value"}}
        
        Ensure the response can be parsed by javascript JSON.parse.`
    }


    private _getExampleMessage() {
        const result: BaseChatMessage[] = []

        result.push(new HumanChatMessage("Hello. What is one plus one?"))

        result.push(new AIChatMessage(`{"tool":"chat","args":{"response":"Two."}}`))

        return result
    }

    async formatMessages({
        chat_history,
        input
    }: {
        input: string;
        chat_history: BaseChatMessage[] | string
    }) {
        const result: BaseChatMessage[] = []

        result.push(new SystemChatMessage(this._constructFullSystemPrompt()))

        let usedTokens = await this._countMessageTokens(result[0])

        const inputTokens = input && input.length > 0 ? await this.tokenCounter(input) : 0

        usedTokens += inputTokens

        const exampleMessage = this._getExampleMessage()

        for (const message of exampleMessage) {
            let messageTokens = await this._countMessageTokens(message)

            usedTokens += messageTokens
            result.push(message)
        }

        let formatConversationSummary: SystemChatMessage
        if (!this.messagesPlaceholder) {
            chat_history = (chat_history as BaseChatMessage[])[0].text

            const chatHistoryTokens = await this.tokenCounter(chat_history as string)

            if (usedTokens + chatHistoryTokens > this.sendTokenLimit) {
                logger.warn(`Used tokens: ${usedTokens + chatHistoryTokens} exceed limit: ${this.sendTokenLimit}. Is too long history. Splitting the history.`)
            }

            // splice the chat history
            chat_history = chat_history.slice(-chat_history.length * 0.6)


            formatConversationSummary = await this.conversationSummaryPrompt.format({
                chat_history: chat_history
            })

            result.push(formatConversationSummary)

        } else {
            const formatChatHistory: BaseChatMessage[] = []

            for (const message of (<BaseChatMessage[]>chat_history).slice(-100).reverse()) {

                let messageTokens = await this._countMessageTokens(message)

                // reserve 100 tokens for the long history
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

        // result.splice(systemMessageIndex, 0, systemMessageCopy)

        //  result.push(formatConversationSummary)

        if (input && input.length > 0) {
            result.push(new HumanChatMessage(input))
        }

        logger.debug(`Used tokens: ${usedTokens} exceed limit: ${this.sendTokenLimit}`)

        logger.debug(`messages: ${JSON.stringify(result)}`)

        return result

    }

    async partial(_values: PartialValues): Promise<BasePromptTemplate> {
        throw new Error("Method not implemented.");
    }

    serialize(): SerializedBasePromptTemplate {
        throw new Error("Method not implemented.");
    }

}



export class ChatHubOpenAIFunctionCallPrompt
    extends BaseChatPromptTemplate
    implements ChatHubOpenAIFunctionCallPromptInput {

    systemPrompts: SystemPrompts

    tokenCounter: (text: string) => Promise<number>;

    messagesPlaceholder?: MessagesPlaceholder;

    humanMessagePromptTemplate: HumanMessagePromptTemplate;

    conversationSummaryPrompt: SystemMessagePromptTemplate;

    sendTokenLimit?: number;

    constructor(fields: ChatHubOpenAIFunctionCallPromptInput) {
        super({ inputVariables: ["chat_history", "input"] });

        this.systemPrompts = fields.systemPrompts;
        this.tokenCounter = fields.tokenCounter;

        this.messagesPlaceholder = fields.messagesPlaceholder;
        this.conversationSummaryPrompt = fields.conversationSummaryPrompt;
        this.humanMessagePromptTemplate = fields.humanMessagePromptTemplate ?? HumanMessagePromptTemplate.fromTemplate("{input}");
        this.sendTokenLimit = fields.sendTokenLimit ?? 4096;
    }

    _getPromptType() {
        return "chathub_openai_function_calling" as const;
    }


    private async _countMessageTokens(message: BaseChatMessage) {
        let result = (await Promise.all([this.tokenCounter(message.text), this.tokenCounter(messageTypeToOpenAIRole(message._getType()))])).reduce((a, b) => a + b, 0)

        if (message.name) {
            result += await this.tokenCounter(message.name)
        }

        return result
    }

    async formatMessages({
        chat_history,
        input
    }: {
        input: string;
        chat_history: BaseChatMessage[] | string,

    }) {
        const result: BaseChatMessage[] = []

        let usedTokens = 0

        const systemMessages = this.systemPrompts

        for (const message of systemMessages) {
            let messageTokens = await this._countMessageTokens(message)

            usedTokens += messageTokens
            result.push(message)
        }


        let formatConversationSummary: SystemChatMessage
        if (!this.messagesPlaceholder) {
            chat_history = (chat_history as BaseChatMessage[])[0].text

            const chatHistoryTokens = await this.tokenCounter(chat_history as string)

            if (usedTokens + chatHistoryTokens > this.sendTokenLimit) {
                logger.warn(`Used tokens: ${usedTokens + chatHistoryTokens} exceed limit: ${this.sendTokenLimit}. Is too long history. Splitting the history.`)
            }

            // splice the chat history
            chat_history = chat_history.slice(-chat_history.length * 0.6)


            formatConversationSummary = await this.conversationSummaryPrompt.format({
                chat_history: chat_history
            })

            result.push(formatConversationSummary)

        } else {
            const formatChatHistory: BaseChatMessage[] = []

            for (const message of (<BaseChatMessage[]>chat_history).slice(-100).reverse()) {

                let messageTokens = await this._countMessageTokens(message)

                // reserve 100 tokens for the long history
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

        if (input && input.length > 0) {
            result.push(new HumanChatMessage(input))
        }

        logger.debug(`Used tokens: ${usedTokens} exceed limit: ${this.sendTokenLimit}`)

        logger.debug(`messages: ${JSON.stringify(result)}`)

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
        case "function":
            return "function"
        default:
            throw new Error(`Unknown message type: ${type}`);
    }
}