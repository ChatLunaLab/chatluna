import { h, Session } from 'koishi'
import { Config, logger } from 'koishi-plugin-chatluna'
import { Message } from '../types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { isMessageContentText } from 'koishi-plugin-chatluna/utils/string'
import { MessageContent } from '@langchain/core/messages'

export class MessageTransformer {
    private _transformFunctions: Record<string, MessageTransformFunction> = {}

    constructor(private _config: Config) {}

    async transform(
        session: Session,
        elements: h[],
        model: string,
        message: Message = {
            content: '',
            additional_kwargs: {}
        },
        quote = false
    ): Promise<Message> {
        const sourceElementString = elements.map((h) => h.toString(true)).join()
        const quoteElementString = (
            (session.quote && session.quote.elements) ??
            []
        )
            .map((h) => h.toString(true))
            .join()

        for (const element of elements) {
            const transformFunction = this._transformFunctions[element.type]
            if (transformFunction != null) {
                const result = await transformFunction(
                    session,
                    element,
                    message,
                    model
                )

                if (result === false && element.children) {
                    await this.transform(
                        session,
                        element.children,
                        model,
                        message,
                        false
                    )
                }
            }
        }

        if (
            session.quote &&
            !quote &&
            this._config.includeQuoteReply &&
            sourceElementString !== quoteElementString
        ) {
            const quoteMessage = await this.transform(
                session,
                session.quote.elements ?? [],
                model,
                {
                    content: '',
                    additional_kwargs: {}
                },
                true
            )

            const extractText = (content: MessageContent) => {
                if (typeof content === 'string') return content
                return Array.isArray(content)
                    ? content
                          .filter((item) => isMessageContentText(item))
                          .map((item) => item.text)
                          .join('')
                    : ''
            }

            const extractImages = (content: MessageContent) =>
                Array.isArray(content)
                    ? content.filter((item) => item.type === 'image')
                    : []

            const quoteText = extractText(quoteMessage.content)
            const quoteImages = extractImages(quoteMessage.content)
            const hasImages =
                extractImages(message.content).length > 0 ||
                quoteImages.length > 0

            if (hasImages) {
                if (typeof message.content === 'string') {
                    message.content =
                        message.content.trim().length > 0
                            ? [{ type: 'text', text: message.content }]
                            : []
                }

                if (quoteText && quoteText !== '[image]') {
                    const currentText = extractText(message.content)
                    const quotedContent = `Referenced message: "${quoteText}"\n\nUser's message: ${currentText}`

                    message.content = message.content.filter(
                        (item) => item.type !== 'text'
                    )
                    message.content.unshift({
                        type: 'text',
                        text: quotedContent
                    })
                }

                message.content = [...quoteImages, ...message.content]
            } else if (quoteText && quoteText !== '[image]') {
                const currentText = extractText(message.content)
                message.content = `Referenced message: "${quoteText}"\n\nUser's message: ${currentText}`
            }
        }

        return message
    }

    intercept(type: string, transformFunction: MessageTransformFunction) {
        if (type === 'text' && this._transformFunctions['text'] != null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error('text transform function already exists')
            )
        }

        if (this._transformFunctions[type] != null && !['img'].includes(type)) {
            logger?.warn(
                `transform function for ${type} already exists. Check your installed plugins.`
            )
        }

        this._transformFunctions[type] = transformFunction

        return () => {
            delete this._transformFunctions[type]
        }
    }

    replace(type: string, transformFunction: MessageTransformFunction) {
        if (type === 'text') {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error('text transform function already exists')
            )
        }

        if (this._transformFunctions[type] == null) {
            logger?.warn(
                `transform function for ${type} not exists. Check your installed plugins.`
            )
        }

        this._transformFunctions[type] = transformFunction
        return () => {
            delete this._transformFunctions[type]
        }
    }

    has(type: string) {
        return this._transformFunctions[type] != null
    }
}

export type MessageTransformFunction = (
    session: Session,
    element: h,
    message: Message,
    model?: string
) => Promise<boolean | void>
