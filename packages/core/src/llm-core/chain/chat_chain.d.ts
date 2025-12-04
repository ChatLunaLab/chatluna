import { ChainValues } from '@langchain/core/utils/types'
import {
    ChatLunaLLMCallArg,
    ChatLunaLLMChain,
    ChatLunaLLMChainWrapper
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import type { ChatLunaPromptRenderService } from 'koishi-plugin-chatluna/services/chat'
import { ComputedRef } from '@vue/reactivity'
export interface ChatLunaChatChainInput {
    botName: string
    preset: ComputedRef<PresetTemplate>
    humanMessagePrompt?: string
    historyMemory: BufferMemory
    variableService: ChatLunaPromptRenderService
}
export declare class ChatLunaChatChain
    extends ChatLunaLLMChainWrapper
    implements ChatLunaChatChainInput
{
    botName: string
    chain: ChatLunaLLMChain
    historyMemory: BufferMemory
    preset: ComputedRef<PresetTemplate>
    variableService: ChatLunaPromptRenderService
    constructor({
        botName,
        historyMemory,
        preset,
        chain,
        variableService
    }: ChatLunaChatChainInput & {
        chain: ChatLunaLLMChain
    })

    static fromLLM(
        llm: ChatLunaChatModel,
        {
            botName,
            historyMemory,
            preset,
            variableService
        }: ChatLunaChatChainInput
    ): ChatLunaLLMChainWrapper

    call({
        message,
        stream,
        events,
        session,
        conversationId,
        variables,
        signal,
        maxToken
    }: ChatLunaLLMCallArg): Promise<ChainValues>

    get model(): ChatLunaChatModel
}
