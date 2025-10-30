import { AIMessage } from '@langchain/core/messages'
import { ChainValues } from '@langchain/core/utils/types'
import {
    callChatLunaChain,
    ChatLunaLLMCallArg,
    ChatLunaLLMChain,
    ChatLunaLLMChainWrapper
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { ChatLunaChatPrompt } from 'koishi-plugin-chatluna/llm-core/chain/prompt'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import type { ChatLunaPromptRenderService } from 'koishi-plugin-chatluna/services/chat'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { ComputedRef } from '@vue/reactivity'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'

export interface ChatLunaChatChainInput {
    botName: string
    preset: ComputedRef<PresetTemplate>
    humanMessagePrompt?: string
    historyMemory: BufferMemory
    variableService: ChatLunaPromptRenderService
}

export class ChatLunaChatChain
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
    }) {
        super()
        this.botName = botName

        this.historyMemory = historyMemory
        this.preset = preset
        this.variableService = variableService
        this.chain = chain
    }

    static fromLLM(
        llm: ChatLunaChatModel,
        {
            botName,
            historyMemory,
            preset,
            variableService
        }: ChatLunaChatChainInput
    ): ChatLunaLLMChainWrapper {
        const prompt = new ChatLunaChatPrompt({
            preset,
            tokenCounter: (text) => llm.getNumTokens(text),
            sendTokenLimit:
                llm.invocationParams().maxTokenLimit ??
                llm.getModelMaxContextSize(),
            promptRenderService: variableService
        })

        const chain = new ChatLunaLLMChain({ llm, prompt })

        return new ChatLunaChatChain({
            botName,
            historyMemory,
            variableService,
            preset,
            chain
        })
    }

    async call({
        message,
        stream,
        events,
        session,
        conversationId,
        variables,
        signal,
        maxToken
    }: ChatLunaLLMCallArg): Promise<ChainValues> {
        const requests: ChainValues = {
            input: message
        }
        const chatHistory =
            await this.historyMemory.loadMemoryVariables(requests)

        requests['chat_history'] = chatHistory[this.historyMemory.memoryKey]
        requests['variables'] = Object.assign(variables ?? {}, {
            prompt: getMessageContent(message.content)
        })
        requests['variables_hide'] = requests['variables']
        requests['configurable'] = {
            session
        }
        requests['id'] = conversationId

        const response = await callChatLunaChain(
            this.chain,
            {
                ...requests,
                stream,
                maxTokens: maxToken,
                signal
            },
            events
        )

        if (response == null || response.text == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.API_REQUEST_FAILED,
                new Error(`No response from LLM: ${JSON.stringify(response)}`)
            )
        }

        const aiMessage = response.message ?? new AIMessage(response.text)

        response.message = aiMessage

        return response
    }

    get model() {
        return this.chain.llm
    }
}
