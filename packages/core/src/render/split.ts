import { BaseMessageChunk } from '@langchain/core/messages'
import { h } from 'koishi'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { parseElements } from 'koishi-plugin-chatluna/utils/koishi'
import type { RenderOptions, SplitMode } from '../types'
import { nextTextCut, splitText as splitByMode } from './sentence'

export class TextStreamSplitter {
    private buf = ''
    private inContent: boolean
    private stopped = false

    constructor(
        private readonly opts: RenderOptions,
        private readonly mode: SplitMode = opts.split ?? 'none'
    ) {
        this.inContent = opts.prefix == null
    }

    write(chunk: BaseMessageChunk) {
        return this.writeText(getMessageContent(chunk.content))
    }

    writeText(text: string) {
        if (!text || this.stopped) return []
        this.buf += text

        if (!this.inContent) {
            const idx = this.opts.prefix
                ? this.buf.indexOf(this.opts.prefix)
                : -1
            if (idx === -1) return []
            this.inContent = true
            this.buf = this.buf.slice(idx + this.opts.prefix.length)
        }

        if (this.opts.postfix) {
            const idx = this.buf.indexOf(this.opts.postfix)
            if (idx !== -1) {
                this.buf = this.buf.slice(0, idx)
                this.stopped = true
                return this.drain(true)
            }
        }

        return this.drain(false)
    }

    flush() {
        if (!this.inContent) return []
        return this.drain(true)
    }

    private drain(flush: boolean) {
        if (this.mode === 'none') {
            if (!flush || !this.buf.trim()) return []
            const result = [this.buf]
            this.buf = ''
            return result
        }

        if (this.mode === 'paragraph') return this.drainParagraph(flush)

        return this.drainSentence(flush)
    }

    private drainParagraph(flush: boolean) {
        const result: string[] = []

        let match = /\n\n+/.exec(this.buf)
        while (match != null) {
            const idx = match!.index
            const content = this.buf.slice(0, idx)
            if (content.trim()) result.push(content)
            this.buf = this.buf.slice(idx + match![0].length)
            match = /\n\n+/.exec(this.buf)
        }

        if (flush && this.buf.trim()) {
            result.push(this.buf)
            this.buf = ''
        }

        return result
    }

    private drainSentence(flush: boolean) {
        const result: string[] = []

        while (this.buf) {
            const end = nextTextCut(this.buf, flush)
            if (end === -1) break

            const content = this.buf.slice(0, end)
            if (content.trim()) result.push(content)
            this.buf = this.buf.slice(end)
        }

        if (flush && this.buf.trim()) {
            result.push(this.buf)
            this.buf = ''
        }

        return result
    }
}

export class MessageElementSplitter {
    private buf = ''

    write(chunk: BaseMessageChunk) {
        return this.writeText(getMessageContent(chunk.content))
    }

    writeText(text: string) {
        if (!text) return []
        this.buf += text
        const result = parseElements(this.buf, true)
        this.buf = result.rest
        return result.elements
    }

    flush() {
        if (!this.buf.trim()) return []
        try {
            return parseElements(this.buf)
        } catch {
            return [h.text(this.buf)]
        } finally {
            this.buf = ''
        }
    }
}

export function extractText(elements: h[]) {
    return elements.map((el) => el.toString()).join('')
}

export function splitText(text: string, mode: SplitMode = 'none') {
    return splitByMode(text, mode)
}
