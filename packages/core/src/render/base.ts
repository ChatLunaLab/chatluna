import { BaseMessageChunk } from '@langchain/core/messages'
import { Context, h, Schema } from 'koishi'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { Message, RenderMessage, RenderOptions } from '../types'
import { RenderStreamPlan, RenderStreamSession } from './types'
import { TextStreamSplitter } from './split'

class BufferStreamSession implements RenderStreamSession {
    private chunk: BaseMessageChunk | null = null

    async write(chunk: BaseMessageChunk) {
        this.chunk = this.chunk == null ? chunk : this.chunk.concat(chunk)
        return null
    }

    flush() {
        return null
    }

    get message(): Message | null {
        return this.chunk == null ? null : { content: this.chunk.content }
    }
}

export abstract class Renderer {
    constructor(protected readonly ctx: Context) {}

    abstract render(
        message: Message,
        options: RenderOptions
    ): Promise<RenderMessage>

    getStreamPlan(_options: RenderOptions): RenderStreamPlan {
        return { mode: 'buffer' }
    }

    createStreamSession(
        _options: RenderOptions,
        _plan: RenderStreamPlan
    ): RenderStreamSession {
        return new BufferStreamSession()
    }

    async renderStreamMessage(
        stream: RenderStreamSession,
        message: Message,
        options: RenderOptions
    ): Promise<h[] | null> {
        const buffered = stream as BufferStreamSession
        const result = await this.render(buffered.message ?? message, options)
        return Array.isArray(result.element) ? result.element : [result.element]
    }

    abstract schema: Schema<string, string>
}

export abstract class BufferedRenderStreamSession implements RenderStreamSession {
    protected text = ''
    protected splitter: TextStreamSplitter

    constructor(
        protected readonly options: RenderOptions,
        protected readonly plan: RenderStreamPlan,
        mode = options.split ?? 'none'
    ) {
        this.splitter = new TextStreamSplitter(options, mode)
    }

    async write(chunk: BaseMessageChunk) {
        return await this.writeText(getMessageContent(chunk.content))
    }

    async flush() {
        if (this.plan.mode === 'edit' && this.text.trim()) {
            return await this.renderText(this.text)
        }

        if (this.plan.mode === 'split') {
            return await this.renderParts(this.splitter.flush())
        }

        if (this.plan.mode === 'buffer' && this.text.trim()) {
            return await this.renderText(this.text)
        }

        return null
    }

    protected async writeText(text: string) {
        if (!text) return null

        if (this.plan.mode === 'edit') {
            this.text += text
            return await this.renderText(this.text + '●')
        }

        if (this.plan.mode === 'split') {
            return await this.renderParts(this.splitter.writeText(text))
        }

        this.text += text
        return null
    }

    protected async renderParts(parts: string[]) {
        if (parts.length < 1) return null

        const result: h[] = []
        for (const part of parts) {
            result.push(...(await this.renderText(part)))
        }
        return result.length > 0 ? result : null
    }

    protected abstract renderText(text: string): Promise<h[]> | h[]
}
