import { Logger } from 'koishi'
import { ChatMessage } from './types'
import OpenAIAdapter from '.'
import { Conversation, InjectData, Message, SimpleMessage } from '@dingyi222666/koishi-plugin-chathub'
import { Tiktoken, TiktokenModel, encoding_for_model } from "@dqbd/tiktoken";
import { lookup } from 'dns';


export class Prompt {

    private logger = new Logger('@dingyi222666/chathub-openai-adapter/prompt')

    private tiktoken: Tiktoken
    static maxTokenLength = 4006

    constructor(
        private readonly config: OpenAIAdapter.Config
    ) { }

    private generatChatMessage(role: 'user' | 'system' | 'model', message: Message, injectMessage: boolean): ChatMessage {
        let content: string

        if (injectMessage && message.inject) {
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

            builder.push("content: " + data.title)

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

        // 把人格设定放进去
        if (initialMessage && initialMessage instanceof Array) {
            initialMessage.forEach((msg) => {
                result.push({
                    role: 'system',
                    content: msg.content,
                    name: msg.sender ?? 'system'
                })
            })
        } else if (initialMessage) {
            result.push({
                role: 'system',
                content: (<SimpleMessage>initialMessage).content,
                name: (<SimpleMessage>initialMessage).sender ?? 'system'
            })
        }

        currentTokenLength = this.calculateTokenLength(result[0])

        // 放入当前会话
        const firstChatMessage = this.generatChatMessage('user', currentMessage, true && currentMessage.inject !== null)

        currentTokenLength += this.calculateTokenLength(currrentChatMessage)


        let addToPormptMessageLength = 1
        while (currentTokenLength < Prompt.maxTokenLength) {
            if (currentMessage.parentId === null) {
                break
            }
            currentMessage = conversation.messages[currentMessage.parentId]

            currrentChatMessage = this.generatChatMessage(message.role, currentMessage, false)

            const tokenLength = this.calculateTokenLength(currrentChatMessage)

            if (currentTokenLength + tokenLength > Prompt.maxTokenLength) {
                // loss some message
                const lostMessageLenght = Object.keys(conversation.messages).length - addToPormptMessageLength
                this.logger.warn(`Prompt message length is too long, loss ${lostMessageLenght} messages`)
                break
            }

            result.unshift(currrentChatMessage)
            addToPormptMessageLength++
            currentTokenLength += tokenLength
        }

        result.push(firstChatMessage)
        this.logger.info(`Prompt: ${JSON.stringify(result)}`)
        this.logger.info(`Prompt token length is ${currentTokenLength}`)

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

