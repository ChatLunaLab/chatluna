import { ChainValues } from '@langchain/core/utils/types'
import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import {
    ChatLunaLLMCallArg,
    ChatLunaLLMChain,
    ChatLunaLLMChainWrapper
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
export interface ChatLunaInfiniteContextChainInput {
    historyMemory: BufferMemory
}
export interface ChatLunaInfiniteContextChunkArg {
    chunk: string
    conversationId: string
    signal?: AbortSignal
}
export declare class ChatLunaInfiniteContextChain
    extends ChatLunaLLMChainWrapper
    implements ChatLunaInfiniteContextChainInput
{
    historyMemory: BufferMemory
    private chain
    constructor({
        historyMemory,
        chain
    }: ChatLunaInfiniteContextChainInput & {
        chain: ChatLunaLLMChain
    })

    static fromLLM(
        llm: ChatLunaChatModel,
        { historyMemory }: ChatLunaInfiniteContextChainInput
    ): ChatLunaInfiniteContextChain

    compressChunk({
        chunk,
        conversationId,
        signal
    }: ChatLunaInfiniteContextChunkArg): Promise<string | null>

    private _isAlreadyCompressed
    call(
        arg: ChatLunaLLMCallArg & {
            chunk?: string
        }
    ): Promise<ChainValues>

    get model(): ChatLunaChatModel
}
