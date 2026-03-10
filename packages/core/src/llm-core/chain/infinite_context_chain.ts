import { ChainValues } from '@langchain/core/utils/types'
import { PromptTemplate } from '@langchain/core/prompts'
import { AIMessage, type UsageMetadata } from '@langchain/core/messages'
import { BufferMemory } from 'koishi-plugin-chatluna/llm-core/memory/langchain'
import {
    ChatLunaLLMCallArg,
    ChatLunaLLMChain,
    ChatLunaLLMChainWrapper
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'

export interface ChatLunaInfiniteContextChainInput {
    historyMemory: BufferMemory
}

export interface ChatLunaInfiniteContextChunkArg {
    chunk: string
    conversationId: string
    signal?: AbortSignal
}

export interface ChatLunaInfiniteContextChunkResult {
    text: string
    usageMetadata?: UsageMetadata
}

export class ChatLunaInfiniteContextChain
    extends ChatLunaLLMChainWrapper
    implements ChatLunaInfiniteContextChainInput
{
    historyMemory: BufferMemory

    private chain: ChatLunaLLMChain

    constructor({
        historyMemory,
        chain
    }: ChatLunaInfiniteContextChainInput & { chain: ChatLunaLLMChain }) {
        super()
        this.historyMemory = historyMemory
        this.chain = chain
    }

    static fromLLM(
        llm: ChatLunaChatModel,
        { historyMemory }: ChatLunaInfiniteContextChainInput
    ) {
        const prompt =
            PromptTemplate.fromTemplate(`You are a helpful AI assistant tasked with summarizing conversations.

When asked to summarize, provide a detailed but concise summary of the conversation.
Focus on information that would be helpful for continuing the conversation, including:
- What was done
- What is currently being worked on
- Which files are being modified
- What needs to be done next
- Key user requests, constraints, or preferences that should persist
- Important technical decisions and why they were made

Your summary should be comprehensive enough to provide context but concise enough to be quickly understood.

Do not respond to any questions in the conversation, only output the summary.

Conversation:
{conversation_chunk}`)

        const chain = new ChatLunaLLMChain({ llm, prompt })

        return new ChatLunaInfiniteContextChain({
            historyMemory,
            chain
        })
    }

    async compressChunk({
        chunk,
        conversationId,
        signal
    }: ChatLunaInfiniteContextChunkArg): Promise<ChatLunaInfiniteContextChunkResult | null> {
        const trimmedChunk = chunk?.trim()

        if (!trimmedChunk) {
            return null
        }

        const result = await this.chain.invoke({
            conversation_chunk: trimmedChunk,
            id: conversationId,
            stream: false,
            signal
        })

        const rawMessage = (result['message'] ?? null) as AIMessage | null

        const text =
            (result['text'] ?? '').toString().trim() ||
            (rawMessage ? getMessageContent(rawMessage.content).trim() : '')

        if (!text) {
            return null
        }

        return {
            text,
            usageMetadata: rawMessage?.usage_metadata
        }
    }

    async call(
        arg: ChatLunaLLMCallArg & { chunk?: string }
    ): Promise<ChainValues> {
        const chunk = arg['chunk'] ?? getMessageContent(arg.message.content)

        if (!chunk?.trim()) {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error(
                    'Empty context chunk passed to Infinite Context chain'
                )
            )
        }

        return this.chain.invoke({
            conversation_chunk: chunk,
            id: arg.conversationId,
            stream: arg.stream,
            signal: arg.signal,
            maxTokens: arg.maxToken
        })
    }

    get model(): ChatLunaChatModel {
        return this.chain.llm
    }
}
