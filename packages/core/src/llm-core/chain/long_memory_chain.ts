import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { FakeEmbeddings } from '@langchain/core/utils/testing'
import { ChainValues } from '@langchain/core/utils/types'
import { logger } from 'koishi-plugin-chatluna'
import {
    ChatHubLLMCallArg,
    ChatHubLLMChain,
    ChatHubLLMChainWrapper,
    SystemPrompts
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaSaveableVectorStore } from 'koishi-plugin-chatluna/llm-core/model/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    BufferMemory,
    ConversationSummaryMemory,
    VectorStoreRetrieverMemory
} from 'langchain/memory'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'

export interface ChatHubChatChainInput {
    systemPrompts?: SystemPrompts
    historyMemory?: ConversationSummaryMemory | BufferMemory
    longMemory?: VectorStoreRetrieverMemory
    longMemoryCall?: number
}

export class ChatHubLongMemoryChain
    extends ChatHubLLMChainWrapper
    implements ChatHubChatChainInput
{
    botName: string

    longMemory: VectorStoreRetrieverMemory

    chain: ChatHubLLMChain

    historyMemory: ConversationSummaryMemory | BufferMemory

    systemPrompts?: SystemPrompts

    llm: ChatLunaChatModel

    longMemoryCall: number

    constructor({
        longMemory,
        systemPrompts,
        historyMemory,
        longMemoryCall,
        llm
    }: ChatHubChatChainInput & {
        llm: ChatLunaChatModel
    }) {
        super()

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
        this.longMemoryCall = longMemoryCall ?? 3
        this.llm = llm
        this.systemPrompts = systemPrompts
    }

    static fromLLM(
        llm: ChatLunaChatModel,
        { longMemory, historyMemory, systemPrompts }: ChatHubChatChainInput
    ): ChatHubLongMemoryChain {
        return new ChatHubLongMemoryChain({
            longMemory,
            historyMemory,
            systemPrompts,
            llm
        })
    }

    async call(_: ChatHubLLMCallArg): Promise<ChainValues> {
        const selectHistoryLength = Math.min(4, this.longMemoryCall * 2)

        const selectChatHistory = (
            await this.historyMemory.chatHistory.getMessages()
        )
            .slice(-selectHistoryLength)
            .map((chatMessage) => {
                if (chatMessage._getType() === 'human') {
                    return `user: ${chatMessage.content}`
                } else if (chatMessage._getType() === 'ai') {
                    return `your: ${chatMessage.content}`
                } else if (chatMessage._getType() === 'system') {
                    return `System: ${chatMessage.content}`
                } else {
                    return `${chatMessage.content}`
                }
            })
            .join('\n')

        logger?.debug('select chat history: %s', selectChatHistory)

        const input = LONG_MEMORY_PROMPT.replaceAll(
            '{user_input}',
            selectChatHistory
        )

        const messages: BaseMessage[] = []

        if (this.systemPrompts) {
            messages.push(...this.systemPrompts)
        }

        messages.push(new HumanMessage(input))

        const response = await this.llm.invoke(messages)

        logger?.debug('save long memory, %s', response.content)

        const vectorStore = this.longMemory.vectorStoreRetriever.vectorStore

        vectorStore.addDocuments([
            {
                pageContent: response.content as string,
                metadata: {
                    source: 'long_memory'
                }
            }
        ])

        if (vectorStore instanceof ChatLunaSaveableVectorStore) {
            logger?.debug('saving vector store')
            await vectorStore.save()
        }

        return response
    }

    get model() {
        return this.chain.llm
    }
}

const LONG_MEMORY_PROMPT = `
Deduce the facts, preferences, and memories from the provided text.
Just return the facts, preferences, and memories in bullet points:
Natural language chat history: {user_input}

Constraint for deducing facts, preferences, and memories:
- The facts, preferences, and memories should be concise and informative.
- Don't start by "The person likes Pizza". Instead, start with "Likes Pizza".
- Don't remember the user/agent details provided. Only remember the facts, preferences, and memories.
- The output language should be the same as the input language. For example, if the input language is Chinese, the output language should also be Chinese.

Deduced facts, preferences, and memories:`
