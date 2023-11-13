import { Context } from 'koishi'
import {
    AIMessage,
    BaseChatMessageHistory,
    BaseMessage,
    BaseMessageFields,
    HumanMessage,
    MessageContent,
    MessageType,
    SystemMessage
} from 'langchain/schema'
import { v4 as uuidv4 } from 'uuid'

export class KoishiChatMessageHistory extends BaseChatMessageHistory {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_namespace: string[] = ['llm-core', 'memory', 'message']

    conversationId: string

    private _ctx: Context
    private _latestId: string
    private _serializedChatHistory: ChatHubMessage[]
    private _chatHistory: BaseMessage[]
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private _additional_kwargs: Record<string, string>

    constructor(
        ctx: Context,
        conversationId: string,
        private _maxMessagesCount: number
    ) {
        super()

        this.conversationId = conversationId
        this._ctx = ctx
        this._chatHistory = []
        this._additional_kwargs = {}
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    get additional_kwargs() {
        return this._additional_kwargs
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

    async addMessage(message: BaseMessage): Promise<void> {
        await this._saveMessage(message)
    }

    async clear(): Promise<void> {
        await this._ctx.database.remove('chathub_message', {
            conversation: this.conversationId
        })

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
        await this._ctx.database.remove('chathub_conversation', {
            id: this.conversationId
        })
    }

    async updateAdditionalKwargs(key: string, value: string): Promise<void> {
        await this.loadConversation()
        this._additional_kwargs[key] = value
        await this._saveConversation()
    }

    async getAdditionalKwargs(key: string): Promise<string> {
        await this.loadConversation()

        return this._additional_kwargs[key]
    }

    async deleteAdditionalKwargs(key: string): Promise<void> {
        await this.loadConversation()
        delete this._additional_kwargs[key]
        await this._saveConversation()
    }

    async overrideAdditionalKwargs(kwargs: {
        [key: string]: string
    }): Promise<void> {
        await this.loadConversation()
        this._additional_kwargs = Object.assign(this._additional_kwargs, kwargs)
        await this._saveConversation()
    }

    private async _loadMessages(): Promise<BaseMessage[]> {
        const queried = await this._ctx.database.get('chathub_message', {
            conversation: this.conversationId
        })

        const sorted: ChatHubMessage[] = []

        let currentMessageId = this._latestId

        if (currentMessageId == null && queried.length > 0) {
            throw new Error('latestId is null but queried is not empty')
        }

        while (currentMessageId != null) {
            const currentMessage = queried.find(
                (item) => item.id === currentMessageId
            )

            if (!currentMessage) {
                throw new Error('currentMessage is null')
            }

            sorted.unshift(currentMessage)

            currentMessageId = currentMessage.parent
        }

        this._serializedChatHistory = sorted

        return sorted.map((item) => {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const kw_args = JSON.parse(item.additional_kwargs ?? '{}')
            const content = JSON.parse(item.text as string) as MessageContent
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fields: BaseMessageFields = {
                content,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                additional_kwargs: kw_args as any
            }
            if (item.role === 'system') {
                return new SystemMessage(fields)
            } else if (item.role === 'human') {
                return new HumanMessage(fields)
            } else if (item.role === 'ai') {
                return new AIMessage(fields)
            } else {
                throw new Error('Unknown role')
            }
        })
    }

    private async _loadConversation() {
        const conversation = (
            await this._ctx.database.get('chathub_conversation', {
                id: this.conversationId
            })
        )?.[0]

        if (conversation) {
            this._latestId = conversation.latestId
            this._additional_kwargs =
                conversation.additional_kwargs != null
                    ? JSON.parse(conversation.additional_kwargs)
                    : {}
        } else {
            await this._ctx.database.create('chathub_conversation', {
                id: this.conversationId
            })
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
        const lastedMessage = this._serializedChatHistory.find(
            (item) => item.id === this._latestId
        )

        const serializedMessage: ChatHubMessage = {
            id: uuidv4(),
            text: JSON.stringify(message.content),
            parent: lastedMessage?.id,
            role: message._getType(),
            additional_kwargs: message.additional_kwargs
                ? JSON.stringify(message.additional_kwargs)
                : undefined,
            conversation: this.conversationId
        }

        await this._ctx.database.upsert('chathub_message', [serializedMessage])

        this._serializedChatHistory.push(serializedMessage)
        this._chatHistory.push(message)
        this._latestId = serializedMessage.id

        if (this._serializedChatHistory.length > this._maxMessagesCount) {
            const toDeleted = this._serializedChatHistory.splice(
                0,
                this._serializedChatHistory.length - this._maxMessagesCount
            )

            await this._ctx.database.remove('chathub_message', {
                id: toDeleted.map((item) => item.id)
            })

            // update latest message

            const firstMessage = this._serializedChatHistory[0]

            // first message
            firstMessage.parent = null

            await this._ctx.database.upsert('chathub_message', [firstMessage])
        }

        await this._saveConversation()
    }

    private async _saveConversation() {
        await this._ctx.database.upsert('chathub_conversation', [
            {
                id: this.conversationId,
                latestId: this._latestId,
                additional_kwargs: JSON.stringify(this._additional_kwargs)
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
    text: MessageContent
    id: string
    role: MessageType
    conversation: string
    additional_kwargs?: string
    parent?: string
}

export interface ChatHubConversation {
    id: string
    latestId?: string
    additional_kwargs?: string
}
