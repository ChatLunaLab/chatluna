import { h, Session } from 'koishi'
import { Config } from 'koishi-plugin-chatluna'
import { Message } from '../types'
export declare class MessageTransformer {
    private _config
    private _transformFunctions
    constructor(_config: Config)
    transform(
        session: Session,
        elements: h[],
        model: string,
        message?: Message,
        options?: {
            quote: boolean
            includeQuoteReply: boolean
        }
    ): Promise<Message>

    intercept(
        type: string,
        transformFunction: MessageTransformFunction,
        priority?: number
    ): () => void

    replace(
        type: string,
        transformFunction: MessageTransformFunction
    ): () => void

    has(type: string): boolean
    private _processElement
}
export type MessageTransformFunction = (
    session: Session,
    element: h,
    message: Message,
    model?: string
) => Promise<boolean | void>
