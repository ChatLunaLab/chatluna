import { Context } from 'koishi'
import { AIMessage, BaseMessage, BaseChatMessageHistory, ChatMessage, FunctionMessage, HumanMessage, MessageType, SystemMessage } from 'langchain/schema'
import { v4 as uuidv4 } from 'uuid'

export class KoishiDataBaseChatMessageHistory extends BaseChatMessageHistory {

    lc_namespace: string[] = ['llm-core', "memory", "message"]

    conversationId: string

    private _extraParams: Record<string, any>

    private _ctx: Context
    private _latestId: string
    private _serializedChatHistory: Message[]
    private _chatHistory: BaseMessage[]

    constructor(ctx: Context, conversationId: string, extraParams?: Record<string, any>) {
        super()

        this.conversationId = conversationId
        this._extraParams = extraParams ?? {}
        this._ctx = ctx
        this._chatHistory = []
    }


    async getMessages(): Promise<BaseMessage[]> {
        this._chatHistory = await this._loadMessages()

        return this._chatHistory
    }

    async addUserMessage(message: string): Promise<void> {
        const humanMessage = new HumanMessage(message)
        await this._saveMessage(humanMessage)
    }

    async addAIChatMessage(message: string): Promise<void> {
        const aiMessage = new AIMessage(message)
        await this._saveMessage(aiMessage)
    }

    async clear(): Promise<void> {
        await this._ctx.database.remove('chathub_message', { conversation: this.conversationId })

        await this._ctx.database.upsert('chathub_conversation', [
            {
                id: this.conversationId,
                extraParams: this._extraParams,
                latestId: null
            }
        ])

        this._serializedChatHistory = []
        this._chatHistory = []
        this._latestId = null
    }

    async delete(): Promise<void> {
        await this._ctx.database.remove('chathub_conversation', { id: this.conversationId })
    }

    updateExtraParams(extraParams: Record<string, any>): Promise<void> {
        this._extraParams = extraParams

        return this._ctx.database.upsert('chathub_conversation', [
            {
                id: this.conversationId,
                extraParams: this._extraParams,
                latestId: this._latestId
            }
        ])
    }

    private async _loadMessages(): Promise<BaseMessage[]> {
        if (!this._extraParams) {
            await this._loadConversation()
        }

        const queried = await this._ctx.database.get('chathub_message', { conversation: this.conversationId })

        const sorted: Message[] = []

        let currentMessageId = this._latestId

        if (currentMessageId == null && queried.length > 0) {
            throw new Error('latestId is null but queried is not empty')
        }

        while (currentMessageId != null) {
            const currentMessage = queried.find((item) => item.id === currentMessageId)

            if (!currentMessage) {
                throw new Error('currentMessage is null')
            }

            sorted.unshift(currentMessage)

            currentMessageId = currentMessage.parent
        }

        this._serializedChatHistory = sorted

        return sorted.map((item) => {
            const kw_args = JSON.parse(item.additional_kwargs ?? '{}')
            if (item.role === "system") {
                return new SystemMessage(item.text, kw_args)
            } else if (item.role === "human") {
                return new HumanMessage(item.text, kw_args)
            } else if (item.role === "ai") {
                return new AIMessage(item.text, kw_args)
            } else if (item.role == "function") {
                return new FunctionMessage(item.text, kw_args)
            }
            else {
                return new ChatMessage(item.text, item.role)
            }
        })
    }

    private async _loadConversation() {
        const conversation = (await this._ctx.database.get('chathub_conversation', { id: this.conversationId }))?.[0]

        if (conversation) {
            this._extraParams = conversation.extraParams
            this._latestId = conversation.latestId
        } else {
            await this._ctx.database.create('chathub_conversation', { id: this.conversationId, extraParams: this._extraParams })
            this._extraParams = {}
        }

        if (!this._serializedChatHistory) {
            await this._loadMessages()
        }

    }

    async loadConversation() {
        if (!this._serializedChatHistory) {
            await this._loadConversation()
        }
    }

    private async _saveMessage(message: BaseMessage) {
        const lastedMessage = this._serializedChatHistory.find((item) => item.id === this._latestId)

        const serializedMessage: Message = {
            id: uuidv4(),
            text: message.content,
            parent: lastedMessage?.id,
            role: message._getType(),
            additional_kwargs: message.additional_kwargs ? JSON.stringify(message.additional_kwargs) : undefined,
            conversation: this.conversationId
        }

        await this._ctx.database.upsert('chathub_message', [serializedMessage])

        this._serializedChatHistory.push(serializedMessage)
        this._chatHistory.push(message)
        this._latestId = serializedMessage.id

        await this._ctx.database.upsert('chathub_conversation', [
            {
                id: this.conversationId,
                extraParams: this._extraParams,
                latestId: this._latestId
            }
        ])
    }

}



declare module 'koishi' {
    interface Tables {
        chathub_conversation: Conversation
        chathub_message: Message
    }
}

export interface Message {
    text: string
    id: string
    role: MessageType
    conversation: string,
    additional_kwargs?: string,
    parent?: string
}

export interface Conversation {
    id: string
    extraParams?: Record<string, any>
    latestId?: string
}