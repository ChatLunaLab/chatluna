import { AIMessage } from '@langchain/core/messages'
import { ChainValues } from '@langchain/core/utils/types'
import {
    callChatHubChain,
    ChatHubLLMCallArg,
    ChatHubLLMChain,
    ChatHubLLMChainWrapper
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    BufferMemory,
    ConversationSummaryMemory
} from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import { ChatHubChatPrompt } from 'koishi-plugin-chatluna/llm-core/chain/prompt'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'

export interface ChatHubChatChainInput {
    botName: string
    preset: () => Promise<PresetTemplate>
    humanMessagePrompt?: string
    historyMemory: ConversationSummaryMemory | BufferMemory
}

export class ChatHubChatChain
    extends ChatHubLLMChainWrapper
    implements ChatHubChatChainInput
{
    botName: string

    chain: ChatHubLLMChain

    historyMemory: ConversationSummaryMemory | BufferMemory

    preset: () => Promise<PresetTemplate>

    constructor({
        botName,
        historyMemory,
        preset,
        chain
    }: ChatHubChatChainInput & {
        chain: ChatHubLLMChain
    }) {
        super()
        this.botName = botName

        this.historyMemory = historyMemory
        this.preset = preset
        this.chain = chain
    }

    static fromLLM(
        llm: ChatLunaChatModel,
        { botName, historyMemory, preset }: ChatHubChatChainInput
    ): ChatHubLLMChainWrapper {
        const prompt = new ChatHubChatPrompt({
            preset,
            tokenCounter: (text) => llm.getNumTokens(text),
            historyMode:
                historyMemory instanceof ConversationSummaryMemory
                    ? 'summary'
                    : 'window',
            sendTokenLimit:
                llm.invocationParams().maxTokenLimit ??
                llm.getModelMaxContextSize()
        })

        const chain = new ChatHubLLMChain({ llm, prompt })

        return new ChatHubChatChain({
            botName,
            historyMemory,
            preset,
            chain
        })
    }

    async call({
        message,
        stream,
        events,
        conversationId,
        variables,
        signal
    }: ChatHubLLMCallArg): Promise<ChainValues> {
        const requests: ChainValues = {
            input: message
        }
        const chatHistory =
            await this.historyMemory.loadMemoryVariables(requests)

        requests['chat_history'] = chatHistory[this.historyMemory.memoryKey]
        requests['variables'] = variables ?? {}
        requests['id'] = conversationId

        const response = await callChatHubChain(
            this.chain,
            {
                ...requests,
                stream,
                signal
            },
            events
        )

        if (response.text == null) {
            throw new Error('response.text is null')
        }

        const responseString = response.text

        const aiMessage = new AIMessage(responseString)

        response.message = aiMessage

        return response
    }

    get model() {
        return this.chain.llm
    }
}
