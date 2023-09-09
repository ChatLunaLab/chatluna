import { h, Session } from 'koishi'
import { Message } from '../types'
import { ChatHubError, ChatHubErrorCode } from '../utils/error'
import { createLogger } from '../utils/logger'

const logger = createLogger()

export class MessageTransformer {
    private _transformFunctions: Record<string, MessageTransformFunction> = {}

    constructor() {}

    transform(session: Session, elements: h[]): Message {
        const message: Message = {
            content: '',
            additional_kwargs: {}
        }

        for (const element of elements) {
            const transformFunction = this._transformFunctions[element.type]
            if (transformFunction != null) {
                transformFunction(session, element, message)
            }
        }

        return message
    }

    intercept(type: string, transformFunction: MessageTransformFunction) {
        if (type === 'text' && this._transformFunctions['text'] != null) {
            throw new ChatHubError(ChatHubErrorCode.UNKNOWN_ERROR, new Error('text transform function already exists'))
        }

        if (this._transformFunctions[type] != null) {
            logger.warn(`transform function for ${type} already exists. Check your installed plugins.`)
        }

        this._transformFunctions[type] = transformFunction
    }
}

export type MessageTransformFunction = (session: Session, element: h, message: Message) => Promise<void>
