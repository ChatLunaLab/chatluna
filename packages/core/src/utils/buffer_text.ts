import { sleep } from 'koishi'
import { ObjectLock } from 'koishi-plugin-chatluna/utils/lock'

export class BufferText {
    private queue: string[] = []
    private currentText = ''

    private lock = new ObjectLock()
    private isEnd = false
    private isTextStarted = false
    private rawText = ''

    constructor(
        private readonly isStreaming: boolean,
        private readonly sleepTime = 3,
        private readonly prefix?: string,
        private readonly postfix?: string
    ) {}

    async addText(text: string) {
        if (this.isEnd) {
            return
        }

        const id = await this.lock.lock()

        if (this.isStreaming) {
            this.queue.push(...text.split(''))
        } else {
            const diffText = text.substring(
                Math.min(text.length, this.currentText.length)
            )

            this.queue.push(...diffText.split(''))
        }

        this.currentText = text

        await this.lock.unlock(id)
    }

    private async *getText() {
        while (this.queue.length > 0 || !this.isEnd) {
            const text = await this.processChar()

            if (text == null) {
                await sleep(this.sleepTime)
                continue
            }

            this.rawText += text

            yield text
        }
    }

    private async processChar() {
        if (this.queue.length < 1) {
            return undefined
        }

        const id = await this.lock.lock()

        const text = this.queue.shift()

        await this.lock.unlock(id)

        if (!this.isEnd) {
            await sleep(this.sleepTime)
        }

        return text
    }

    async *get() {
        let bufferText = ''

        for await (const char of this.getText()) {
            if (
                this.prefix == null ||
                (this.isTextStarted && this.postfix == null)
            ) {
                yield char
                continue
            }

            bufferText += char

            if (bufferText.startsWith(this.prefix)) {
                this.isTextStarted = true
                bufferText = ''
                continue
            }

            if (this.postfix == null || !this.isTextStarted) {
                yield char
                continue
            }

            for (let i = 0; i < this.postfix.length; i++) {
                const char = this.postfix[i]

                if (bufferText?.[i] !== char) {
                    bufferText = ''
                    break
                }
            }

            if (this.postfix.startsWith(bufferText)) {
                continue
            }

            if (bufferText === this.postfix) {
                this.isEnd = true
                this.isTextStarted = false
                bufferText = ''
                continue
            }

            yield char
        }
    }

    async *splitByMarkdown() {
        let bufferText = ''

        for await (const char of this.get()) {
            bufferText += char
            const lastTwoChars = bufferText.slice(-2)

            if (lastTwoChars === '\n\n') {
                yield bufferText.slice(0, -2)
                bufferText = ''
            }
        }

        if (bufferText.length > 0) {
            yield bufferText
        }
    }

    async *splitByPunctuations() {
        const punctuations = ['，', '.', '。', '!', '！', '?', '？']
        const sendTogglePunctuations = ['.', '!', '！', '?', '？']

        let bufferText = ''

        for await (const char of this.get()) {
            const inPunctuation = punctuations.includes(char)
            const includeSendPunctuation = sendTogglePunctuations.includes(char)

            if (includeSendPunctuation) {
                bufferText += char
            }

            if (inPunctuation) {
                yield bufferText
                bufferText = ''
                continue
            }

            bufferText += char
        }

        if (bufferText.length > 0) {
            yield bufferText
        }
    }

    async *getCached(endText: string = '●') {
        let bufferText = ''

        for await (const char of this.get()) {
            bufferText += char

            yield bufferText + endText
        }

        yield bufferText
    }

    end() {
        this.isEnd = true
    }
}
