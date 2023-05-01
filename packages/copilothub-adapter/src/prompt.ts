import { Logger } from 'koishi'
import { Conversation, ConversationConfig, InjectData, Message, SimpleMessage, createLogger } from '@dingyi222666/koishi-plugin-chathub'


import { CopilotMessage } from './types'
import CopilotHubAdapter from '.'
import { Tiktoken, encoding_for_model } from '@dqbd/tiktoken'


const logger = createLogger('@dingyi222666/chathub-copilothub-adapter/prompt')

export class Prompt {

    private tiktoken: Tiktoken
    // 我记得好像实际上只有2000的上下文？
    static maxTokenLength = 4100

    constructor(
        config: CopilotHubAdapter.Config
    ) {
        // ?
        // Prompt.maxTokenLength = Prompt.maxTokenLength 
    }

    private generatCopilotMessage(role: 'user' | 'system' | 'model', config: ConversationConfig, message: Message, isCurrentMessage: boolean = false): CopilotMessage {
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
            role: role,
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

    private calculateTokenLength(message: CopilotMessage): number {
        return this.tiktoken.encode(JSON.stringify(message)).length
    }

    generatePrompt(conversation: Conversation, message: Message): CopilotMessage[] {
        const result: CopilotMessage[] = []
        
        let currrentCopilotMessage: CopilotMessage
        let currentTokenLength = 0
        let currentMessage = message

        this.tiktoken = this.tiktoken ?? encoding_for_model("gpt-3.5-turbo");

      

        // 放入当前会话
        const firstCopilotMessage = this.generatCopilotMessage('user', conversation.config, currentMessage, true)


        result.unshift(firstCopilotMessage)

        currentTokenLength += this.calculateTokenLength(firstCopilotMessage)

        currentMessage = message
        let addToPormptMessageLength = 1
        while (currentTokenLength < Prompt.maxTokenLength) {

            if (currentMessage.parentId == null) {
                break
            }

            currentMessage = conversation.messages[currentMessage.parentId]

            currrentCopilotMessage = this.generatCopilotMessage(currentMessage.role, conversation.config, currentMessage)

            const tokenLength = this.calculateTokenLength(currrentCopilotMessage)

            if (currentTokenLength + tokenLength > Prompt.maxTokenLength) {
                // loss some message
                const lostMessageLength = Object.keys(conversation.messages).length - addToPormptMessageLength
                logger.warn(`prompt token length is too long, loss ${lostMessageLength} messages`)
                break
            }

            result.unshift(currrentCopilotMessage)

            logger.debug(`sub prompt: ${JSON.stringify(currrentCopilotMessage)}`)

            addToPormptMessageLength++
            currentTokenLength += tokenLength

        }


        logger.debug(`prompt: ${JSON.stringify(result)}`)
        logger.debug(`prompt token length: ${currentTokenLength}`)

        return result
    }

    generatePromptForChat(conversation: Conversation, message: Message): string {
        const chatMessages = this.generatePrompt(conversation, message)

        const result = []

        chatMessages.forEach((chatMessage) => {
            const data = {
                role: chatMessage.role,
                content: chatMessage.content,
                name: chatMessage.role
            }
            result.push(JSON.stringify(data))
        })

        //等待补全
        const buffer = []

        buffer.push('[')

        for (const text of result) {
            buffer.push(text)
            buffer.push(',')
        }

        return buffer.join('')

    }


    dispose() {
        this.tiktoken.free()
        this.tiktoken = null
    }

}

