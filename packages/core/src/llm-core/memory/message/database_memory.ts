import { Context } from 'koishi'
import { AIMessage, BaseMessage, BaseChatMessageHistory, ChatMessage, FunctionMessage, HumanMessage, MessageType, SystemMessage } from 'langchain/schema'
import { v4 as uuidv4 } from 'uuid'

export class KoishiDataBaseChatMessageHistory extends BaseChatMessageHistory {

    lc_namespace: string[] = ['llm-core', "memory", "message"]

    conversationId: string

    private _ctx: Context
    private _latestId: string
    private _serializedChatHistory: ChatHubMessage[]
    private _chatHistory: BaseMessage[]
    private _isLoaded: boolean = false

    constructor(ctx: Context, conversationId: string, private _maxMessageCount: number) {
        super()

        this.conversationId = conversationId
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

  

    private async _loadMessages(): Promise<BaseMessage[]> {
        if (!this._isLoaded) {
            await this._loadConversation()
        }

        const queried = await this._ctx.database.get('chathub_message', { conversation: this.conversationId })

        const sorted: ChatHubMessage[] = []

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
            this._latestId = conversation.latestId
        } else {
            await this._ctx.database.create('chathub_conversation', { id: this.conversationId})
        }

        this._isLoaded = true

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

        const serializedMessage: ChatHubMessage = {
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

        if (this._serializedChatHistory.length > this._maxMessageCount) { 
            const toDeleted = this._serializedChatHistory.splice(0, this._serializedChatHistory.length - this._maxMessageCount)

            await this._ctx.database.remove('chathub_message', { id: toDeleted.map((item) => item.id) })
        }

        await this._ctx.database.upsert('chathub_conversation', [
            {
                id: this.conversationId,
                latestId: this._latestId
            }
        ])
    }

}



declare module 'koishi' {
    interface Tables {
        chathub_conversation: ChatHubConversation
        chathub_message: ChatHubMessage
    }
}

export interface ChatHubMessage {
    text: string
    id: string
    role: MessageType
    conversation: string,
    additional_kwargs?: string,
    parent?: string
}

export interface ChatHubConversation {
    id: string
    latestId?: string
}