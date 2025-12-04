import { BaseChatMessageHistory } from '@langchain/core/chat_history'
import { Embeddings } from '@langchain/core/embeddings'
import { ChainValues } from '@langchain/core/utils/types'
import { Context, Session } from 'koishi'
import { ConversationRoom } from '../../types'
import { ChatLunaLLMCallArg, ChatLunaLLMChainWrapper } from '../chain/base'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { ComputedRef } from '@vue/reactivity'
export declare class ChatInterface {
    ctx: Context
    private _input
    private _chatHistory
    private _chain
    private _embeddings
    private _historyMemory?
    private _infiniteContextManager?
    private _chatCount
    constructor(ctx: Context, input: ChatInterfaceInput)
    private handleChatError
    chat(arg: ChatLunaLLMCallArg): Promise<ChainValues>
    private processChat
    private handlePostProcessing
    getChatLunaLLMChainWrapper(): Promise<ChatLunaLLMChainWrapper>
    createChatLunaLLMChainWrapper(): Promise<void>
    get chatHistory(): BaseChatMessageHistory
    get chatMode(): string
    get embeddings(): ComputedRef<Embeddings>
    get preset(): ComputedRef<PresetTemplate>
    delete(ctx: Context, room: ConversationRoom): Promise<void>
    clearChatHistory(): Promise<void>
    private _initEmbeddings
    private _initModel
    private _supportChatMode
    private _createChatHistory
    private _createHistoryMemory
    private _ensureInfiniteContextManager
}
export interface ChatInterfaceInput {
    chatMode: string
    botName?: string
    preset?: ComputedRef<PresetTemplate>
    model: string
    embeddings?: string
    vectorStoreName?: string
    conversationId: string
}
declare module 'koishi' {
    interface Events {
        'chatluna/before-chat': (
            conversationId: string,
            message: HumanMessage,
            promptVariables: ChainValues,
            chatInterface: ChatInterface,
            session: Session
        ) => Promise<void>
        'chatluna/after-chat': (
            conversationId: string,
            sourceMessage: HumanMessage,
            responseMessage: AIMessage,
            promptVariables: ChainValues,
            chatInterface: ChatInterface,
            session: Session
        ) => Promise<void>
        'chatluna/clear-chat-history': (
            conversationId: string,
            chatInterface: ChatInterface
        ) => Promise<void>
        'chatluna/after-chat-error': (
            error: Error,
            conversationId: string,
            sourceMessage: HumanMessage,
            promptVariables: ChainValues,
            chatInterface: ChatInterface,
            chain?: ChatLunaLLMChainWrapper
        ) => Promise<void>
    }
}
