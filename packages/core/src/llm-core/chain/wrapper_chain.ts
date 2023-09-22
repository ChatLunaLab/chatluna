import { AIMessage, ChainValues } from 'langchain/schema'
import { BufferMemory, ConversationSummaryMemory } from 'langchain/memory'
import { ChatHubLLMCallArg, ChatHubLLMChainWrapper } from './base'
import { ChatHubChatModel } from '../platform/model'
import { BaseChain } from 'langchain/chains'

export interface ChatHubWrapperChainInput {
    chain: BaseChain
    historyMemory: ConversationSummaryMemory | BufferMemory
    baseModel: ChatHubChatModel
    inputKey?: string
}

export class ChatHubWrapperChain
    extends ChatHubLLMChainWrapper
    implements ChatHubWrapperChainInput
{
    chain: BaseChain
    historyMemory: ConversationSummaryMemory | BufferMemory
    baseModel: ChatHubChatModel

    inputKey?: string

    constructor(fields: ChatHubWrapperChainInput) {
        super()

        this.chain = fields.chain
        this.historyMemory = fields.historyMemory
        this.baseModel = fields.baseModel
        this.inputKey = fields.inputKey ?? 'input'
    }

    static fromLLM(
        llm: ChatHubChatModel,
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

        const response = await this.chain.call(
            {
                ...requests,
                stream
            },
            [
                {
                    handleLLMNewToken(token: string) {
                        //     events?.['llm-new-token']?.(token)
                    }
                }
            ]
        )

        const responseString = response[this.chain.outputKeys[0]]

        await this.historyMemory.saveContext(
            { input: message.content },
            { output: responseString }
        )

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
