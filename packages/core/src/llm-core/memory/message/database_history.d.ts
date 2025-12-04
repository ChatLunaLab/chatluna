import { Context } from 'koishi'
import {
    AIMessage,
    BaseMessage,
    MessageContent,
    MessageType
} from '@langchain/core/messages'
import { BaseChatMessageHistory } from '@langchain/core/chat_history'
export declare class KoishiChatMessageHistory extends BaseChatMessageHistory {
    private _maxMessagesCount
    lc_namespace: string[]
    conversationId: string
    private _ctx
    private _latestId
    private _serializedChatHistory
    private _chatHistory
    private _additional_kwargs
    private _updatedAt
    constructor(ctx: Context, conversationId: string, _maxMessagesCount: number)
    get additionalArgs(): Record<string, string>
    getMessages(): Promise<BaseMessage[]>
    addUserMessage(message: string): Promise<void>
    addAIChatMessage(message: string): Promise<void>
    addMessage(message: BaseMessage): Promise<void>
    clear(): Promise<void>
    delete(): Promise<void>
    updateAdditionalArg(key: string, value: string): Promise<void>
    getAdditionalArg(key: string): Promise<string>
    getAdditionalArgs(): Promise<{
        [key: string]: string
    }>

    deleteAdditionalArg(key: string): Promise<void>
    removeAllToolAndFunctionMessages(): Promise<void>
    overrideAdditionalArgs(kwargs: { [key: string]: string }): Promise<void>
    private getLatestUpdateTime
    private _loadMessages
    private _loadConversation
    loadConversation(): Promise<void>
    private _saveMessage
    private _saveConversation
}
declare module 'koishi' {
    interface Tables {
        chathub_conversation: ChatLunaConversation
        chathub_message: ChatLunaMessage
    }
}
export interface ChatLunaMessage {
    text: MessageContent
    id: string
    rawId?: string
    role: MessageType
    conversation: string
    name?: string
    tool_call_id?: string
    tool_calls?: AIMessage['tool_calls']
    additional_kwargs?: string
    additional_kwargs_binary?: ArrayBuffer
    parent?: string
}
export interface ChatLunaConversation {
    id: string
    latestId?: string
    additional_kwargs?: string
    updatedAt?: Date
}
