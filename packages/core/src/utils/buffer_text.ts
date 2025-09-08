import { Element, Fragment, h, Session } from 'koishi'
import { BaseMessageChunk } from '@langchain/core/messages'
import { logger } from '..'
import { ObjectLock } from 'koishi-plugin-chatluna/utils/lock'

export class StreamingBufferText {
    private isEnd = false
    public finalChunk: BaseMessageChunk | null = null
    private processors = new Map<
        string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        TransformStream<BaseMessageChunk, any>
    >()

    private writers = new Map<
        string,
        WritableStreamDefaultWriter<BaseMessageChunk>
    >()

    private lock = new ObjectLock()

    constructor(
        private readonly sleepTime = 3,
        private readonly prefix?: string,
        private readonly postfix?: string
    ) {}

    private createProcessor<T = Element>(
        name: string,
        transform: Transformer<BaseMessageChunk, T>
    ): ReadableStream<T> {
        if (this.processors.has(name)) {
            return this.processors.get(name)!.readable
        }

        const processor = new TransformStream<BaseMessageChunk, T>(transform)
        this.processors.set(name, processor)
        return processor.readable
    }

    async writeChunk(chunk: BaseMessageChunk) {
        await this.lock.runLocked(async () => {
            this.finalChunk =
                this.finalChunk != null ? this.finalChunk.concat(chunk) : chunk

            for (const [name, processor] of this.processors) {
                if (!this.writers.has(name)) {
                    this.writers.set(name, processor.writable.getWriter())
                }
                const writer = this.writers.get(name)!

                await writer.write(chunk)
            }
        })
    }

    processChunk(chunk: BaseMessageChunk): Element[] {
        const content = chunk.content
        const elements: Element[] = []

        if (typeof content === 'string') {
            elements.push(h.text(content))
        } else if (Array.isArray(content)) {
            for (const item of content) {
                if (item.type === 'text' && item.text) {
                    elements.push(h.text(item.text))
                } else if (item.type === 'image_url' && item.image_url) {
                    elements.push(
                        h.image(
                            typeof item.image_url === 'string'
                                ? item.image_url
                                : item.image_url.url
                        )
                    )
                }
            }
        }

        return elements
    }

    splitByMarkdown(): ReadableStream<Element> {
        let bufferText = ''
        let inContent = this.prefix == null

        return this.createProcessor('markdown', {
            transform: async (chunk, controller) => {
                const elements = this.processChunk(chunk)

                for (const element of elements) {
                    if (element.type === 'text') {
                        const text =
                            typeof element.children?.[0] === 'string'
                                ? element.children[0]
                                : element.attrs?.content || ''

                        for (const char of text) {
                            bufferText += char

                            if (!inContent) {
                                if (
                                    this.prefix &&
                                    bufferText.endsWith(this.prefix)
                                ) {
                                    inContent = true
                                    bufferText = ''
                                }
                            } else {
                                if (
                                    this.postfix &&
                                    bufferText.endsWith(this.postfix)
                                ) {
                                    const content = bufferText.slice(
                                        0,
                                        -this.postfix.length
                                    )
                                    if (content.trim()) {
                                        controller.enqueue(h.text(content))
                                    }
                                    return
                                }

                                let searchIndex = 0
                                while (true) {
                                    const doubleNewlineIndex =
                                        bufferText.indexOf('\n\n', searchIndex)
                                    if (doubleNewlineIndex === -1) break

                                    const content = bufferText.substring(
                                        0,
                                        doubleNewlineIndex
                                    )
                                    if (content.trim()) {
                                        controller.enqueue(h.text(content))
                                    }
                                    bufferText = bufferText.substring(
                                        doubleNewlineIndex + 2
                                    )
                                    searchIndex = 0
                                }
                            }
                        }
                    } else {
                        if (inContent) {
                            controller.enqueue(element)
                        }
                    }
                }
            },
            flush: (controller) => {
                if (inContent && bufferText.trim()) {
                    controller.enqueue(h.text(bufferText))
                }
                controller.terminate()
            }
        })
    }

    splitByPunctuations(): ReadableStream<Element> {
        const punctuations = ['，', '.', '。', '!', '！', '?', '？']
        // const sendTogglePunctuations = ['.', '!', '！', '?', '？']
        let bufferText = ''
        let inContent = this.prefix == null

        return this.createProcessor('punctuations', {
            transform: async (chunk, controller) => {
                const elements = this.processChunk(chunk)

                for (const element of elements) {
                    if (element.type === 'text') {
                        const text =
                            typeof element.children?.[0] === 'string'
                                ? element.children[0]
                                : element.attrs?.content || ''

                        for (const char of text) {
                            bufferText += char

                            if (!inContent) {
                                if (
                                    this.prefix &&
                                    bufferText.endsWith(this.prefix)
                                ) {
                                    inContent = true
                                    bufferText = ''
                                }
                            } else {
                                if (
                                    this.postfix &&
                                    bufferText.endsWith(this.postfix)
                                ) {
                                    const content = bufferText.slice(
                                        0,
                                        -this.postfix.length
                                    )
                                    if (content.trim()) {
                                        controller.enqueue(h.text(content))
                                    }
                                    return
                                }

                                const inPunctuation =
                                    punctuations.includes(char)
                                /* const includeSendPunctuation =
                                    sendTogglePunctuations.includes(char) */

                                if (inPunctuation) {
                                    if (bufferText.trim()) {
                                        controller.enqueue(h.text(bufferText))
                                    }
                                    bufferText = ''
                                    continue
                                }
                            }
                        }
                    } else {
                        if (inContent) {
                            controller.enqueue(element)
                        }
                    }
                }
            },
            flush: (controller) => {
                if (inContent && bufferText.trim()) {
                    controller.enqueue(h.text(bufferText))
                }
                controller.terminate()
            }
        })
    }

    getCached(endText: string = '●'): ReadableStream<Element[]> {
        const state = {
            elements: [] as Element[],
            inContent: this.prefix == null,
            buffer: ''
        }

        return this.createProcessor<Element[]>('cached', {
            transform: async (chunk, controller) => {
                const elements = this.processChunk(chunk)

                for (const element of elements) {
                    if (element.type === 'text') {
                        const text = this.extractText(element)
                        if (this.processTextContent(state, text)) {
                            controller.enqueue([...state.elements])
                            return
                        }
                    } else if (state.inContent) {
                        state.elements.push(element)
                    }
                }

                if (
                    state.inContent &&
                    state.elements.length > 0 &&
                    !this.isEnd
                ) {
                    controller.enqueue(this.addEndText(state.elements, endText))
                }
            },
            flush: async (controller) => {
                if (state.inContent && state.elements.length > 0) {
                    controller.enqueue(state.elements)
                }
                controller.terminate()
            }
        })
    }

    private extractText(element: Element): string {
        return typeof element.children?.[0] === 'string'
            ? element.children[0]
            : element.attrs?.content || ''
    }

    private processTextContent(
        state: {
            elements: Element[]
            inContent: boolean
            buffer: string
        },
        text: string
    ): boolean {
        if (!state.inContent) {
            if (this.prefix && text.includes(this.prefix)) {
                state.inContent = true
                const afterPrefix = text.slice(
                    text.indexOf(this.prefix) + this.prefix.length
                )
                if (afterPrefix) {
                    this.mergeTextElement(state.elements, h.text(afterPrefix))
                }
            }
            return false
        }

        if (this.postfix && text.includes(this.postfix)) {
            const beforePostfix = text.slice(0, text.indexOf(this.postfix))
            if (beforePostfix) {
                this.mergeTextElement(state.elements, h.text(beforePostfix))
            }
            return true
        }

        this.mergeTextElement(state.elements, h.text(text))
        return false
    }

    private addEndText(elements: Element[], endText: string): Element[] {
        if (!endText) return [...elements]

        const result = [...elements]

        result.push(h.text(endText))

        return result
    }

    private mergeTextElement(elements: Element[], newElement: Element) {
        if (newElement.type === 'text' && elements.length > 0) {
            const lastElement = elements[elements.length - 1]
            if (lastElement.type === 'text') {
                const lastText =
                    typeof lastElement.children?.[0] === 'string'
                        ? lastElement.children[0]
                        : lastElement.attrs?.content || ''
                const newText =
                    typeof newElement.children?.[0] === 'string'
                        ? newElement.children[0]
                        : newElement.attrs?.content || ''
                elements[elements.length - 1] = h.text(lastText + newText)
                return
            }
        }
        elements.push(newElement)
    }

    async end() {
        await this.lock.runLocked(async () => {
            for (const writer of this.writers.values()) {
                await writer.ready
                await writer.close()
            }

            this.writers.clear()
            this.processors.clear()
            this.isEnd = true
        })
    }
}

export class MessageEditQueue {
    private currentElements: Element[]
    private isProcessing = false
    private isFinished = false

    async enqueue(messageId: string, session: Session, text: Element[]) {
        this.currentElements = text

        if (!this.isProcessing) {
            this.processQueue(messageId, session)
        }
    }

    private async processQueue(messageId: string, session: Session) {
        this.isProcessing = true

        let lastElements: Element[]
        while (!this.isFinished || this.currentElements !== lastElements) {
            if (this.currentElements === lastElements) break
            lastElements = this.currentElements

            await this.editMessage(messageId, session, lastElements)
        }

        this.isProcessing = false
    }

    private async editMessage(
        messageId: string,
        session: Session,
        text: Fragment
    ) {
        try {
            await session.bot.editMessage(session.channelId, messageId, text)
        } catch (error) {
            logger.error('Error editing message:', error)
        }
    }

    finish() {
        this.isFinished = true
    }
}

export async function sendInitialMessage(
    session: Session,
    text: Fragment
): Promise<string> {
    try {
        const messageIds = await session.bot.sendMessage(
            session.channelId,
            text
        )
        return messageIds[0]
    } catch (error) {
        logger.error('Error sending initial message:', error)
        throw error
    }
}
