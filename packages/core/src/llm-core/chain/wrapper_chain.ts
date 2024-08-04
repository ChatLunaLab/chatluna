import { AIMessage } from '@langchain/core/messages'
import { ChainValues } from '@langchain/core/utils/types'
import {
    ChatHubLLMCallArg,
    ChatHubLLMChainWrapper
} from 'koishi-plugin-chatluna/llm-core/chain/base'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { BaseChain } from 'langchain/chains'
import { BufferMemory, ConversationSummaryMemory } from 'langchain/memory'

export interface ChatHubWrapperChainInput {
    chain: BaseChain
    historyMemory: ConversationSummaryMemory | BufferMemory
    baseModel: ChatLunaChatModel
    inputKey?: string
}

export class ChatHubWrapperChain
    extends ChatHubLLMChainWrapper
    implements ChatHubWrapperChainInput
{
    chain: BaseChain
    historyMemory: ConversationSummaryMemory | BufferMemory
    baseModel: ChatLunaChatModel

    inputKey?: string

    constructor(fields: ChatHubWrapperChainInput) {
        super()

        this.chain = fields.chain
        this.historyMemory = fields.historyMemory
        this.baseModel = fields.baseModel
        this.inputKey = fields.inputKey ?? 'input'
    }

    static fromLLM(
        llm: ChatLunaChatModel,
        fields: Omit<ChatHubWrapperChainInput, 'baseModel'>
    ): ChatHubWrapperChain {
        return new ChatHubWrapperChain({
            ...fields,
            baseModel: llm
        })
    }

    async call({
        message,
        stream,
        events,
        conversationId
    }: ChatHubLLMCallArg): Promise<ChainValues> {
        const requests: ChainValues = {
            [this.inputKey]: message
        }
        const chatHistory =
            await this.historyMemory.loadMemoryVariables(requests)

        requests['chat_history'] = chatHistory[this.historyMemory.memoryKey]

        requests['id'] = conversationId

        let usedToken = 0

        const response = await this.chain.invoke(
            {
                ...requests,
                stream
            },
            {
                callbacks: [
                    {
                        handleLLMNewToken(token: string) {
                            //     events?.['llm-new-token']?.(token)
                        },
                        handleLLMEnd(output, runId, parentRunId, tags) {
                            usedToken +=
                                output.llmOutput?.tokenUsage?.totalTokens
                        }
                    }
                ]
            }
        )

        await events?.['llm-used-token-count']?.(usedToken)

        const responseString = response[this.chain.outputKeys[0]]

        await this.historyMemory.chatHistory.addMessage(message)
        await this.historyMemory.chatHistory.addAIChatMessage(responseString)

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
        return this.baseModel
    }
}
