import { Logger } from 'koishi'
import { ChatMessage } from './types'
import OpenAIAdapter from '.'
import { Conversation, ConversationConfig, InjectData, Message, SimpleMessage } from '@dingyi222666/koishi-plugin-chathub'
import { Tiktoken, TiktokenModel, encoding_for_model, get_encoding } from "@dqbd/tiktoken";
import { lookup } from 'dns';


export class Prompt {

    private logger = new Logger('@dingyi222666/chathub-openai-adapter/prompt')

    private tiktoken: Tiktoken
    static maxTokenLength = 4050

    constructor(
        private readonly config: OpenAIAdapter.Config
    ) { }

    private generatChatMessage(role: 'user' | 'system' | 'model', config: ConversationConfig, message: Message, isCurrentMessage: boolean = false): ChatMessage {
        let content: string

        if ((isCurrentMessage && config.inject != 'none' ||
            !isCurrentMessage && config.inject == 'enhanced') && message.inject) {
            const injectPrompt = `这是我从你之前的对话或者从网络上获得的信息，请你参考这些信息基于我们的对话生成回复：${this.formatInjectData(message.inject)}\n。下面是我的对话的内容： `
            content = injectPrompt + message.content
        }
        else {
            content = message.content
        }

        return {
            role: role == 'model' ? 'assistant' : role,
            content: content,
            name: message.sender ?? role
        }
    }

    private formatInjectData(inject: InjectData[]): string {
        const result = []

        inject.forEach((data) => {
            const builder = []

            if (data.title) {
                builder.push("title: " + data.title)
            }

            builder.push("content: " + data.data.trim())

            if (data.source) {
                builder.push("source: " + data.source)
            }

            result.push(builder.join())
        })

        return result.join(' ')
    }

    private calculateTokenLength(message: ChatMessage): number {
        return this.tiktoken.encode(JSON.stringify(message)).length
    }

    generatePrompt(conversation: Conversation, message: Message): ChatMessage[] {
        const result: ChatMessage[] = []
        const initialMessage = conversation.config.initialPrompts
        let currrentChatMessage: ChatMessage
        let currentTokenLength = 0
        let currentMessage = message

        this.tiktoken = this.tiktoken ?? encoding_for_model(<TiktokenModel>this.config.chatModel);

        this.logger.info(`conversation: ${conversation.id}`)

        const initialMessages = []

        // 把人格设定放进去
        if (initialMessage && initialMessage instanceof Array) {
            initialMessage.forEach((msg) => {
                initialMessages.push({
                    role: 'system',
                    content: msg.content,
                    name: msg.sender ?? 'system'
                })
            })
        } else if (initialMessage) {
            initialMessages.push({
                role: 'system',
                content: (<SimpleMessage>initialMessage).content,
                name: (<SimpleMessage>initialMessage).sender ?? 'system'
            })
        }

        for (let i = initialMessages.length - 1; i >= 0; i--) {
            const initialMessage = initialMessages[i]
            const tokenLength = this.calculateTokenLength(initialMessage)
            currentTokenLength += tokenLength
        }

        // 放入当前会话
        const firstChatMessage = this.generatChatMessage('user', conversation.config, currentMessage, true)


        result.unshift(firstChatMessage)

        currentTokenLength += this.calculateTokenLength(firstChatMessage)

        currentMessage = message
        let addToPormptMessageLength = 1
        while (currentTokenLength < Prompt.maxTokenLength) {

            if (currentMessage.parentId == undefined) {
                break
            }

            currentMessage = conversation.messages[currentMessage.parentId]

            currrentChatMessage = this.generatChatMessage(currentMessage.role, conversation.config, currentMessage)

            const tokenLength = this.calculateTokenLength(currrentChatMessage)

            if (currentTokenLength + tokenLength > Prompt.maxTokenLength) {
                // loss some message
                const lostMessageLenght = Object.keys(conversation.messages).length - addToPormptMessageLength
                this.logger.warn(`prompt token length is too long, loss ${lostMessageLenght} messages`)
                break
            }

            result.unshift(currrentChatMessage)

            this.logger.info(`sub prompt: ${JSON.stringify(currrentChatMessage)}`)

            addToPormptMessageLength++
            currentTokenLength += tokenLength

        }

        result.unshift(...initialMessages)


        this.logger.info(`prompt: ${JSON.stringify(result)}`)
        this.logger.info(`prompt token length: ${currentTokenLength}`)

        return result
    }

    generatePromptForDavinci(conversation: Conversation, message: Message): string {
        const chatMessages = this.generatePrompt(conversation, message)

        const result = []

        chatMessages.forEach((chatMessage) => {
            const data = {
                name: chatMessage.role,
                content: chatMessage.content
            }
            result.push(data)
        })

        return JSON.stringify(result)
    }

    dispose() {
        this.tiktoken.free()
        this.tiktoken = null
    }

}

