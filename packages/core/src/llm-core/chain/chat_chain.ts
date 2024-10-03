import { AIMessage, SystemMessage } from '@langchain/core/messages'
import {
    HumanMessagePromptTemplate,
    MessagesPlaceholder
} from '@langchain/core/prompts'
import { FakeEmbeddings } from '@langchain/core/utils/testing'
import { ChainValues } from '@langchain/core/utils/types'
import {
    callChatHubChain,
    ChatHubLLMCallArg,
    ChatHubLLMChain,
    ChatHubLLMChainWrapper,
    SystemPrompts
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    BufferMemory,
    ConversationSummaryMemory,
    VectorStoreRetrieverMemory
} from 'langchain/memory'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { ChatHubChatPrompt } from './prompt'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'

export interface ChatHubChatChainInput {
    botName: string
    preset: () => Promise<PresetTemplate>
    longMemory?: VectorStoreRetrieverMemory
    humanMessagePrompt?: string
    historyMemory: ConversationSummaryMemory | BufferMemory
}

export class ChatHubChatChain
    extends ChatHubLLMChainWrapper
    implements ChatHubChatChainInput
{
    botName: string

    longMemory: VectorStoreRetrieverMemory

    chain: ChatHubLLMChain

    historyMemory: ConversationSummaryMemory | BufferMemory

    preset: () => Promise<PresetTemplate>

    constructor({
        botName,
        longMemory,
        historyMemory,
        systemPrompts,
        chain
    }: ChatHubChatChainInput & {
        chain: ChatHubLLMChain
    }) {
        super()
        this.botName = botName

        // roll back to the empty memory if not set
        this.longMemory =
            longMemory ??
            new VectorStoreRetrieverMemory({
                vectorStoreRetriever: new MemoryVectorStore(
                    new FakeEmbeddings()
                ).asRetriever(6),
                memoryKey: 'long_history',
                inputKey: 'user',
                outputKey: 'ai',
                returnDocs: true
            })
        this.historyMemory = historyMemory
        this.systemPrompts = systemPrompts
        this.chain = chain
    }

    static fromLLM(
        llm: ChatLunaChatModel,
        { botName, longMemory, historyMemory, preset }: ChatHubChatChainInput
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
            longMemory,
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
        signal
    }: ChatHubLLMCallArg): Promise<ChainValues> {
        const requests: ChainValues = {
            input: message
        }
        const chatHistory =
            await this.historyMemory.loadMemoryVariables(requests)

        const longHistory = await this.longMemory.loadMemoryVariables({
            user: message.content
        })

        requests['chat_history'] = chatHistory[this.historyMemory.memoryKey]
        requests['long_history'] = longHistory[this.longMemory.memoryKey]
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

        await this.historyMemory.chatHistory.addMessages([
            message,
            new AIMessage(responseString)
        ])

        const aiMessage = new AIMessage(responseString)
        response.message = aiMessage

        if (
            response.extra != null &&
            'additionalReplyMessages' in response.extra
        ) {
            response.additionalReplyMessages =
                response.extra.additionalReplyMessages
        }

        return response
    }

    get model() {
        return this.chain.llm
    }
}
