import { h, Session } from 'koishi'
import { Config, logger } from 'koishi-plugin-chatluna'
import { Message } from '../types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import {
    isMessageContentImageUrl,
    isMessageContentText
} from 'koishi-plugin-chatluna/utils/string'
import { MessageContent } from '@langchain/core/messages'

interface TransformFunctionWithPriority {
    func: MessageTransformFunction
    priority: number
}

export class MessageTransformer {
    private _transformFunctions: Map<string, TransformFunctionWithPriority[]> =
        new Map()

    constructor(private _config: Config) {}

    async transform(
        session: Session,
        elements: h[],
        model: string,
        message: Message = {
            content: '',
            name: session.username,
            additional_kwargs: {}
        },
        options = {
            quote: false,
            includeQuoteReply: true
        }
    ): Promise<Message> {
        const sourceElementString = elements.map((h) => h.toString(true)).join()
        const quoteElementString = (
            (session.quote && session.quote.elements) ??
            []
        )
            .map((h) => h.toString(true))
            .join()

        for (const element of elements) {
            await this._processElement(session, element, message, model)
        }

        if (
            session.quote &&
            !options.quote &&
            options.includeQuoteReply &&
            sourceElementString !== quoteElementString
        ) {
            const quoteMessage = await this.transform(
                session,
                session.quote.elements ?? [],
                model,
                {
                    content: '',
                    name: session.username,
                    additional_kwargs: {}
                },
                {
                    quote: true,
                    includeQuoteReply: options.includeQuoteReply
                }
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
                    ? content.filter((item) => isMessageContentImageUrl(item))
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

    intercept(
        type: string,
        transformFunction: MessageTransformFunction,
        priority: number = 0
    ) {
        const functions = this._transformFunctions.get(type)

        if (type === 'text' && functions?.length) {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error('text transform function already exists')
            )
        }

        const wrapper: TransformFunctionWithPriority = {
            func: transformFunction,
            priority
        }

        if (!functions) {
            this._transformFunctions.set(type, [wrapper])
        } else {
            const insertIndex = functions.findIndex(
                (item) => item.priority > priority
            )
            if (insertIndex === -1) {
                functions.push(wrapper)
            } else {
                functions.splice(insertIndex, 0, wrapper)
            }
        }

        return () => {
            const currentFunctions = this._transformFunctions.get(type)
            if (!currentFunctions) return

            const index = currentFunctions.findIndex(
                (item) => item.func === transformFunction
            )
            if (index === -1) return

            if (currentFunctions.length === 1) {
                this._transformFunctions.delete(type)
            } else {
                currentFunctions.splice(index, 1)
            }
        }
    }

    replace(type: string, transformFunction: MessageTransformFunction) {
        if (type === 'text') {
            throw new ChatLunaError(
                ChatLunaErrorCode.UNKNOWN_ERROR,
                new Error('text transform function cannot be replaced')
            )
        }

        const functions = this._transformFunctions.get(type)
        if (functions == null || functions.length === 0) {
            logger?.warn(
                `transform function for ${type} not exists. Check your installed plugins.`
            )
        }

        this._transformFunctions.set(type, [
            { func: transformFunction, priority: 0 }
        ])
        return () => {
            this._transformFunctions.delete(type)
        }
    }

    has(type: string) {
        const functions = this._transformFunctions.get(type)
        return functions != null && functions.length > 0
    }

    private async _processElement(
        session: Session,
        element: h,
        message: Message,
        model: string
    ) {
        const transformFunctions = this._transformFunctions.get(element.type)

        if (!transformFunctions?.length) {
            if (element.children?.length) {
                await this.transform(
                    session,
                    element.children,
                    model,
                    message,
                    {
                        quote: false,
                        includeQuoteReply: true
                    }
                )
            }
            return
        }

        const hasChildren = !!element.children?.length

        for (const { func: transformFunction } of transformFunctions) {
            const result = await transformFunction(
                session,
                element,
                message,
                model
            )

            if (result !== false) return

            if (hasChildren) {
                await this.transform(
                    session,
                    element.children,
                    model,
                    message,
                    {
                        quote: false,
                        includeQuoteReply: true
                    }
                )
                return
            }
        }

        if (hasChildren) {
            await this.transform(session, element.children, model, message, {
                quote: false,
                includeQuoteReply: false
            })
        }
    }
}

export type MessageTransformFunction = (
    session: Session,
    element: h,
    message: Message,
    model?: string
) => Promise<boolean | void>
