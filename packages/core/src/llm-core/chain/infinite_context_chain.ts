import { ChainValues } from '@langchain/core/utils/types'
import { PromptTemplate } from '@langchain/core/prompts'
import { BaseMessage } from '@langchain/core/messages'
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
            PromptTemplate.fromTemplate(`You are "Infinite Context", the memory architect for a conversational AI assistant.
Your task is to compress the provided fragment of dialogue into a compact knowledge note that keeps only information necessary to continue future conversations.

Requirements:
- Organise the fragment into clear topics.
- Keep actionable commitments, unresolved questions, decisions, instructions, user preferences, emotional tone shifts, and critical facts.
- Remove chit-chat, repeated phrasing, or expired information.
- Use concise bullet points grouped by topic.
- Respond in the primary language of the fragment.

Format:
<infinite_context>
- Topic: <short title>
  - Detail: <essential fact, instruction, or open task>
</infinite_context>

If nothing important remains, output "<infinite_context />".

Fragment:
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
    }: ChatLunaInfiniteContextChunkArg): Promise<string | null> {
        const trimmedChunk = chunk?.trim()

        if (!trimmedChunk) {
            return null
        }

        if (this._isAlreadyCompressed(trimmedChunk)) {
            return trimmedChunk
        }

        const result = await this.chain.invoke({
            conversation_chunk: trimmedChunk,
            id: conversationId,
            stream: false,
            signal
        })

        const rawMessage = (result['message'] ?? null) as BaseMessage | null

        const text =
            (result['text'] ?? '').toString().trim() ||
            (rawMessage ? getMessageContent(rawMessage.content).trim() : '')

        if (!text) {
            return null
        }

        return text
    }

    private _isAlreadyCompressed(chunk: string): boolean {
        if (!chunk) {
            return false
        }

        if (/<\/?infinite_context/iu.test(chunk)) {
            return true
        }

        if (/source:\s*['"]infinite-context['"]/iu.test(chunk)) {
            return true
        }

        return false
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
