import { Element, Fragment, Session } from 'koishi'
import { BaseMessageChunk } from '@langchain/core/messages'
export declare class StreamingBufferText {
    private readonly sleepTime
    private readonly prefix?
    private readonly postfix?
    private isEnd
    finalChunk: BaseMessageChunk | null
    private processors
    private writers
    private lock
    constructor(sleepTime?: number, prefix?: string, postfix?: string)
    private createProcessor
    writeChunk(chunk: BaseMessageChunk): Promise<void>
    processChunk(chunk: BaseMessageChunk): Element[]
    splitByMarkdown(): ReadableStream<Element>
    splitByPunctuations(): ReadableStream<Element>
    getCached(endText?: string): ReadableStream<Element[]>
    private extractText
    private processTextContent
    private addEndText
    private mergeTextElement
    end(): Promise<void>
}
export declare class MessageEditQueue {
    private currentElements
    private isProcessing
    private isFinished
    enqueue(messageId: string, session: Session, text: Element[]): Promise<void>
    private processQueue
    private editMessage
    finish(): void
}
export declare function sendInitialMessage(
    session: Session,
    text: Fragment
): Promise<string>
