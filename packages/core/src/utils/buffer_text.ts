import { sleep } from 'koishi'
import { ObjectLock } from './lock'

export class BufferText {
    private queue: string[] = []
    private currentText = ''

    private lock = new ObjectLock()
    private isEnd = false
    private isStartText: boolean = false

    constructor(
        private readonly sleepTime = 10,
        private readonly startText: string = undefined,
        private readonly endText: string = undefined
    ) {}

    async addText(text: string) {
        if (this.isEnd) {
            return
        }
        const diffText = text.substring(
            Math.min(text.length, this.currentText.length)
        )

        const id = await this.lock.lock()

        // as string[]
        this.queue.push(...diffText.split(''))

        this.currentText = text

        await this.lock.unlock(id)
    }

    private async *getText() {
        while (this.queue.length > 0 && !this.isEnd) {
            try {
                const id = await this.lock.lock()
                yield await this.processText()
                await this.lock.unlock(id)
            } catch (error) {
                console.error('Error in lock:', error)
            }
        }

        // is end, but there are still text in queue
        if (this.queue.length > 0 && this.isEnd) {
            while (this.queue.length > 0) {
                await this.processText()
            }
        }
    }

    private async processText() {
        const text = this.queue.shift()

        await sleep(this.sleepTime)

        return text
    }

    async *get() {
        let bufferText = ''

        for await (const char of this.getText()) {
            if (
                this.startText == null ||
                (this.isStartText && this.endText == null)
            ) {
                yield char
            }

            bufferText += char

            if (bufferText.startsWith(this.startText)) {
                this.isStartText = true
                bufferText = ''
                continue
            }

            // check bufferText is end
            // char by char, if not

            for (let i = 0; i < this.endText.length; i++) {
                const char = this.endText[i]

                if (bufferText?.[i] !== char) {
                    bufferText = ''
                    break
                }
            }

            if (this.endText.startsWith(bufferText)) {
                // end_text: <end_text>
                // current_text: <end_text

                continue
            }

            if (bufferText === this.endText) {
                this.isEnd = false
                this.isStartText = false
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
            // 倒数前两个 char
            const lastTwoChars = bufferText.slice(-2)

            if (lastTwoChars === '\n\n') {
                yield bufferText.slice(0, -2)
                bufferText = ''
            }
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
            }
        }
    }

    async *getCached(
        cacheChar: number = 10,
        sleepTime: number = 1000,
        endText: string = '•'
    ) {
        let bufferText = ''

        let cachedCharLength = 0
        for await (const char of this.get()) {
            bufferText += char
            cachedCharLength++

            if (cachedCharLength >= cacheChar) {
                yield bufferText + endText
                cachedCharLength = 0
            }

            await sleep(sleepTime)
        }

        yield bufferText
    }

    end() {
        this.isEnd = true
    }
}
