import { ChatLunaLLMChainWrapper } from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ComputedRef } from '@vue/reactivity'
import { KoishiChatMessageHistory } from 'koishi-plugin-chatluna/llm-core/memory/message'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
export interface InfiniteContextManagerOptions {
    chatHistory: KoishiChatMessageHistory
    conversationId: string
    preset?: ComputedRef<PresetTemplate>
}
export declare class InfiniteContextManager {
    private readonly options
    private _chain?
    constructor(options: InfiniteContextManagerOptions)
    compressIfNeeded(wrapper: ChatLunaLLMChainWrapper): Promise<void>
    private _compressMessages
    private _isCompressedMessage
    private _splitChunksForCompression
    private _calculateMessageTokenStats
    private _countMessagesTokens
    private _formatChunkForCompression
    private _ensureInfiniteContextChain
}
