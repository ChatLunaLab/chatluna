import { AIMessage, ChainValues, SystemMessage } from 'langchain/schema'
import {
    BufferMemory,
    ConversationSummaryMemory,
    VectorStoreRetrieverMemory
} from 'langchain/memory'

import {
    ChatHubLLMCallArg,
    ChatHubLLMChain,
    ChatHubLLMChainWrapper,
    SystemPrompts
} from './base'
import {
    HumanMessagePromptTemplate,
    MessagesPlaceholder,
    SystemMessagePromptTemplate
} from 'langchain/prompts'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { FakeEmbeddings } from 'langchain/embeddings/fake'
import { ChatHubChatPrompt } from './prompt'
import { ChatHubSaveableVectorStore } from '../model/base'
import { createLogger } from '../../utils/logger'
import { ChatHubChatModel } from '../platform/model'

const logger = createLogger()

export interface ChatHubChatChainInput {
    botName: string
    systemPrompts?: SystemPrompts
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

    systemPrompts?: SystemPrompts

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
                outputKey: 'your',
                returnDocs: true
            })
        this.historyMemory = historyMemory
        this.systemPrompts = systemPrompts
        this.chain = chain
    }

    static fromLLM(
        llm: ChatHubChatModel,
        {
            botName,
            longMemory,
            historyMemory,
            systemPrompts,
            humanMessagePrompt
        }: ChatHubChatChainInput
    ): ChatHubLLMChainWrapper {
        const humanMessagePromptTemplate =
            HumanMessagePromptTemplate.fromTemplate(
                humanMessagePrompt ?? '{input}'
            )

        let conversationSummaryPrompt: SystemMessagePromptTemplate
        let messagesPlaceholder: MessagesPlaceholder

        if (historyMemory instanceof ConversationSummaryMemory) {
            conversationSummaryPrompt =
                SystemMessagePromptTemplate.fromTemplate(
                    // eslint-disable-next-line max-len
                    `This is some conversation between me and you. Please generate an response based on the system prompt and content below. Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant, and based on these information, generate similar but non-repetitive responses. Pay attention, you need to think more and diverge your creativity) Current conversation: {chat_history}`
                )
        } else {
            conversationSummaryPrompt =
                SystemMessagePromptTemplate.fromTemplate(
                    // eslint-disable-next-line max-len
                    `Relevant pieces of previous conversation: {long_history} (You do not need to use these pieces of information if not relevant, and based on these information, generate similar but non-repetitive responses. Pay attention, you need to think more and diverge your creativity.)`
                )

            messagesPlaceholder = new MessagesPlaceholder('chat_history')
        }
        const prompt = new ChatHubChatPrompt({
            systemPrompts: systemPrompts ?? [
                new SystemMessage(
                    "You are ChatGPT, a large language model trained by OpenAI. Carefully heed the user's instructions."
                )
            ],
            conversationSummaryPrompt,
            messagesPlaceholder,
            tokenCounter: (text) => llm.getNumTokens(text),
            humanMessagePromptTemplate,
            sendTokenLimit:
                llm.invocationParams().maxTokens ?? llm.getModelMaxContextSize()
        })

        const chain = new ChatHubLLMChain({ llm, prompt })

        return new ChatHubChatChain({
            botName,
            longMemory,
            historyMemory,
            systemPrompts,
            chain
        })
    }

    async call({
        message,
        stream,
        events,
        conversationId
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

        const response = await this.chain.call(
            {
                ...requests,
                stream
            },
            [
                {
                    handleLLMNewToken(token: string) {
                        events?.['llm-new-token']?.(token)
                    }
                }
            ]
        )

        if (response.text == null) {
            throw new Error('response.text is null')
        }

        const responseString = response.text

        await this.longMemory.saveContext(
            { user: message.content },
            { your: responseString }
        )

        await this.historyMemory.saveContext(
            { input: message.content },
            { output: responseString }
        )

        const vectorStore = this.longMemory.vectorStoreRetriever.vectorStore

        if (vectorStore instanceof ChatHubSaveableVectorStore) {
            logger.debug('saving vector store')
            await vectorStore.save()
        }

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
