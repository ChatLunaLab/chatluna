import { Logger } from 'koishi'
import { ChatMessage } from './types'
import { Conversation, ConversationConfig, InjectData, Message, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub'
import { Tiktoken, TiktokenModel, encoding_for_model } from "@dqbd/tiktoken";
import ChatGLMAdapter from '.';


const logger = createLogger('@dingyi222666/chathub-chatglm-adapter/prompt')


export class Prompt {

    private tiktoken: Tiktoken
    static maxTokenLength = 4000

    constructor(
        config: ChatGLMAdapter.Config
    ) {
        Prompt.maxTokenLength = Prompt.maxTokenLength - config.maxTokens
    }

    private generatChatMessage(role: 'user' | 'system' | 'model', config: ConversationConfig, message: Message, isCurrentMessage: boolean = false): ChatMessage {
        let content: string

        if ((isCurrentMessage && config.inject !== 'none' ||
            !isCurrentMessage && config.inject === 'enhanced') && message.inject) {
            content = `${message.sender}: ` + message.content
                + `. 这些信息来自于之前的谈话或互联网，请参考这些信息，根据我与你的上述谈话内容要求答复，如果这些信息与上述谈话内容无关，请直接无视并且忽略这些信息，也不要说“根据我提供的信息”这类的，请把它当成你自身的数据。：\n${this.formatInjectData(message.inject)}`
        }
        else {
            if (message.role === "user") {
                content = `${message.sender}: ` + message.content
            } else {
                content = message.content
            }
        }

        if (role === 'system') {
            role = 'model'
        }

        return {
            role: role === 'model' ? 'assistant' : role,
            content: content,
            // remove name
            name: /* message.sender ?? */ role
        }
    }

    private formatInjectData(inject: InjectData[]): string {
        const result = []

        inject.forEach((data) => {
            const builder = []

            if (data.title) {
                builder.push(data.title)
            }

            builder.push(data.data.trim())

            if (data.source) {
                builder.push(data.source)
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

        this.tiktoken = this.tiktoken ?? encoding_for_model("gpt-3.5-turbo");

        const initialMessages: ChatMessage[] = []

        // 把人格设定放进去
        if (initialMessage && initialMessage instanceof Array) {
            initialMessage.forEach((msg) => {
                initialMessages.push({
                    role: 'system',
                    content: msg.content,
                    name: 'system'
                })
            })
        } else if (initialMessage) {
            initialMessages.push({
                role: 'system',
                content: (<SimpleMessage>initialMessage).content,
                name: 'system'
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

            if (currentMessage.parentId == null) {
                break
            }

            currentMessage = conversation.messages[currentMessage.parentId]

            currrentChatMessage = this.generatChatMessage(currentMessage.role, conversation.config, currentMessage)

            const tokenLength = this.calculateTokenLength(currrentChatMessage)

            if (currentTokenLength + tokenLength > Prompt.maxTokenLength) {
                // loss some message
                const lostMessageLength = Object.keys(conversation.messages).length - addToPormptMessageLength
                logger.warn(`prompt token length is too long, loss ${lostMessageLength} messages`)
                break
            }

            result.unshift(currrentChatMessage)

            logger.debug(`sub prompt: ${JSON.stringify(currrentChatMessage)}`)

            addToPormptMessageLength++
            currentTokenLength += tokenLength

        }

        result.unshift(...initialMessages)


        logger.debug(`prompt: ${JSON.stringify(result)}`)
        logger.debug(`prompt token length: ${currentTokenLength}`)

        return result
    }



    dispose() {
        this.tiktoken.free()
        this.tiktoken = null
    }

}

