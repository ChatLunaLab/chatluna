import { Context } from 'koishi'
import { AIChatMessage, BaseChatMessage, BaseChatMessageHistory, ChatMessage, HumanChatMessage, MessageType, SystemChatMessage } from 'langchain/schema'
import { v4 as uuidv4 } from 'uuid'

export class KoishiDatabaseChatMessageHistory extends BaseChatMessageHistory {

    conversationId: string

    private _extraParams: Record<string, any>

    private _ctx: Context
    private _latestId: string
    private _serializedChatHistory: Message[]
    private _chatHistory: BaseChatMessage[]


    constructor(ctx: Context, conversationId: string, extraParams?: Record<string, any>) {
        super()

        ctx.database.extend('chathub_conversaion', {
            id: {
                type: 'char',
                length: 256,
            },
            extraParams: "json",
            latestId: {
                type: 'char',
                length: 256,
                nullable: true
            },
        }, {
            autoInc: false,
            primary: 'id',
            unique: ['id']
        })

        ctx.database.extend('chathub_message', {
            id: {
                type: 'char',
                length: 256,
            },
            text: "text",
            parent: {
                type: 'char',
                length: 256,
                nullable: true
            },
            role: {
                type: 'char',
                length: 20,
            },
            conversation: {
                type: 'char',
                length: 256,
            },
        }, {
            autoInc: false,
            primary: 'id',
            unique: ['id'],
            foreign: {
                conversation: ['chathub_conversaion', 'id']
            }
        })

        this.conversationId = conversationId
        this._extraParams = extraParams ?? {}
        this._ctx = ctx
        this._chatHistory = []
    }


    async getMessages(): Promise<BaseChatMessage[]> {
        this._chatHistory = await this._loadMessages()

        return this._chatHistory
    }

    async addUserMessage(message: string): Promise<void> {
        const humanMessage = new HumanChatMessage(message)
        await this._saveMessage(humanMessage)
    }

    async addAIChatMessage(message: string): Promise<void> {
        const aiMessage = new AIChatMessage(message)
        await this._saveMessage(aiMessage)
    }

    async clear(): Promise<void> {
        await this._ctx.database.remove('chathub_message', { conversation: this.conversationId })
    }

    async delete(): Promise<void> {
        await this._ctx.database.remove('chathub_conversaion', { id: this.conversationId })
    }

    updateExtraParams(extraParams: Record<string, any>): Promise<void> {
        this._extraParams = extraParams

        return this._ctx.database.upsert('chathub_conversaion', [
            {
                id: this.conversationId,
                extraParams: this._extraParams,
                latestId: this._latestId
            }
        ])
    }

    private async _loadMessages(): Promise<BaseChatMessage[]> {

        if (!this._latestId) {
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
            if (item.role === "system") {
                return new SystemChatMessage(item.text)
            } else if (item.role === "human") {
                return new HumanChatMessage(item.text)
            } else if (item.role === "ai") {
                return new AIChatMessage(item.text)
            } else {
                return new ChatMessage(item.text, item.role)
            }
        })
    }

    private async _loadConversation() {
        const conversation = (await this._ctx.database.get('chathub_conversaion', { id: this.conversationId }))?.[0]

        if (conversation) {
            this._extraParams = conversation.extraParams
            this._latestId = conversation.latestId
        } else {
            await this._ctx.database.create('chathub_conversaion', { id: this.conversationId, extraParams: this._extraParams })
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

    private async _saveMessage(message: BaseChatMessage) {


        const lastedMessage = this._serializedChatHistory.find((item) => item.id === this._latestId)

        const serializedMessage: Message = {
            id: uuidv4(),
            text: message.text,
            parent: lastedMessage?.id,
            role: message._getType(),
            conversation: this.conversationId
        }

        await this._ctx.database.upsert('chathub_message', [serializedMessage])

        this._serializedChatHistory.push(serializedMessage)
        this._chatHistory.push(message)
        this._latestId = serializedMessage.id
    }

}



declare module 'koishi' {
    interface Tables {
        chathub_conversaion: Conversation
        chathub_message: Message
    }
}

export interface Message {
    text: string
    id: string
    role: MessageType
    conversation: string
    parent?: string
}

export interface Conversation {
    id: string
    extraParams: Record<string, any>
    latestId?: string
}