import { sleep } from 'koishi'
import { ObjectLock } from 'koishi-plugin-chatluna/utils/lock'

export class BufferText {
    private queue: string[] = []
    private currentText = ''

    private lock = new ObjectLock()
    private isEnd = false
    private isTextStarted = false

    constructor(
        private readonly sleepTime = 3,
        private readonly startText?: string,
        private readonly endText?: string
    ) {}

    async addText(text: string) {
        if (this.isEnd) {
            return
        }

        const id = await this.lock.lock()

        const diffText = text.substring(
            Math.min(text.length, this.currentText.length)
        )

        this.queue.push(...diffText.split(''))

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
                this.startText == null ||
                (this.isTextStarted && this.endText == null)
            ) {
                yield char
                continue
            }

            bufferText += char

            if (bufferText.startsWith(this.startText)) {
                this.isTextStarted = true
                bufferText = ''
                continue
            }

            if (this.endText == null || !this.isTextStarted) {
                yield char
                continue
            }

            for (let i = 0; i < this.endText.length; i++) {
                const char = this.endText[i]

                if (bufferText?.[i] !== char) {
                    bufferText = ''
                    break
                }
            }

            if (this.endText.startsWith(bufferText)) {
                continue
            }

            if (bufferText === this.endText) {
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
