import { ChainValues } from '@langchain/core/utils/types'
import {
    ChatLunaLLMCallArg,
    ChatLunaLLMChainWrapper,
    SystemPrompts
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ChatLunaTool } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { createAgentExecutor } from 'koishi-plugin-chatluna/llm-core/agent'
import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import { ChatLunaChatPrompt } from 'koishi-plugin-chatluna/llm-core/chain/prompt'
import type { ChatLunaPromptRenderService } from 'koishi-plugin-chatluna/services/chat'
import { ComputedRef } from '@vue/reactivity'
export interface ChatLunaPluginChainInput {
    prompt: ChatLunaChatPrompt
    historyMemory: BufferMemory
    embeddings: ChatLunaBaseEmbeddings
    agentMode?: 'tool-calling' | 'react'
    variableService: ChatLunaPromptRenderService
    preset: ComputedRef<PresetTemplate>
}
export declare class ChatLunaPluginChain
    extends ChatLunaLLMChainWrapper
    implements ChatLunaPluginChainInput
{
    executor: ReturnType<typeof createAgentExecutor>
    historyMemory: BufferMemory
    systemPrompts?: SystemPrompts
    llm: ChatLunaChatModel
    embeddings: ChatLunaBaseEmbeddings
    tools: ComputedRef<ChatLunaTool[]>
    variableService: ChatLunaPromptRenderService
    prompt: ChatLunaChatPrompt
    preset: ComputedRef<PresetTemplate>
    agentMode?: 'tool-calling' | 'react'
    private _toolsRef
    constructor({
        historyMemory,
        prompt,
        llm,
        tools,
        preset,
        embeddings,
        agentMode
    }: ChatLunaPluginChainInput & {
        tools: ComputedRef<ChatLunaTool[]>
        llm: ChatLunaChatModel
    })

    static fromLLMAndTools(
        llm: ChatLunaChatModel,
        tools: ComputedRef<ChatLunaTool[]>,
        {
            historyMemory,
            preset,
            embeddings,
            agentMode,
            variableService
        }: Omit<ChatLunaPluginChainInput, 'prompt'>
    ): ChatLunaPluginChain

    private _createExecutor
    call({
        message,
        signal,
        session,
        events,
        conversationId,
        variables,
        maxToken
    }: ChatLunaLLMCallArg): Promise<ChainValues>

    get model(): ChatLunaChatModel
}
