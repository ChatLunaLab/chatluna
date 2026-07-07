import { BaseMessageChunk } from '@langchain/core/messages'
import { Context, Fragment, h, Logger, Session } from 'koishi'
import { ChainMiddlewareContext } from '../chains/chain'
import { Config } from '../config'
import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './base'
import { RenderStreamMode, RenderStreamSession, ReplyFrame } from './types'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'

export interface ReplyStreamOptions {
    enabled: boolean
    send?: boolean
    renderOptions?: RenderOptions
    renderMessage?: (message: Message) => Promise<RenderMessage[]>
    renderAdditional?: (message: Message) => Promise<h[][]>
}

let logger: Logger

export class ReplyStream {
    private mode: RenderStreamMode
    private stream: RenderStreamSession
    private queue: ReplyQueue
    private firstChunk = true
    private finalMessage: Message | null = null
    private send = true
    private sentAdditional = false
    private renderMessage: (message: Message) => Promise<RenderMessage[]>
    private renderAdditional?: (message: Message) => Promise<h[][]>

    constructor(
        private readonly ctx: Context,
        private readonly config: Config,
        private readonly context: ChainMiddlewareContext,
        private readonly renderer: Renderer,
        opts: ReplyStreamOptions
    ) {
        logger = createLogger(ctx)
        const options = {
            ...opts.renderOptions,
            session: context.session
        } as RenderOptions
        const plan = opts.enabled
            ? renderer.getStreamPlan(options)
            : { mode: 'buffer' as const }

        this.mode = plan.mode
        this.stream = renderer.createStreamSession(options, plan)
        this.queue = new ReplyQueue(context.session)
        this.send = opts.send !== false
        this.renderMessage =
            opts.renderMessage ??
            (async (message) => [await this.renderer.render(message, options)])
        this.renderAdditional = opts.renderAdditional
        this.options = options
    }

    private readonly options: RenderOptions

    async write(frame: ReplyFrame) {
        if (frame.type === 'content') {
            await this.writeChunk(frame.chunk)
            return
        }

        if (frame.type === 'mark' && frame.instant) {
            await this.writeMark(frame)
            return
        }

        if (frame.type === 'done') {
            this.finalMessage = frame.message
        }
    }

    async end(frame?: ReplyFrame) {
        if (frame != null) {
            await this.write(frame)
        }

        await this.context.recallThinkingMessage?.()

        if (this.mode === 'buffer') {
            if (this.finalMessage != null) {
                await this.sendMessage(this.finalMessage, 'split')
            }
            await this.queue.finish()
            return
        }

        const elements = await this.stream.flush()
        if (elements != null && elements.length > 0) {
            await this.sendElements(elements)
        } else if (this.firstChunk && this.finalMessage != null) {
            await this.sendMessage(this.finalMessage, 'split')
        }
        await this.sendAdditional()
        await this.queue.finish()
    }

    private async writeChunk(chunk: BaseMessageChunk) {
        if (this.firstChunk) {
            this.firstChunk = false
            await this.context.recallThinkingMessage?.()
        }

        const elements = await this.stream.write(chunk)
        if (elements != null && elements.length > 0) {
            await this.sendElements(elements)
        }
    }

    private async writeMark(frame: Extract<ReplyFrame, { type: 'mark' }>) {
        const content = frame.content ?? frame.name
        await this.sendMessage({ content }, 'split')
    }

    private async sendMessage(message: Message, mode: RenderStreamMode) {
        const messages = await this.renderMessage(message)
        for (const msg of messages) {
            const elements = Array.isArray(msg.element)
                ? msg.element
                : [msg.element]
            await this.sendElements(elements, mode)
        }
    }

    private async sendAdditional() {
        if (this.sentAdditional) return
        this.sentAdditional = true
        if (this.finalMessage == null || this.renderAdditional == null) return

        const messages = await this.renderAdditional(this.finalMessage)
        for (const elements of messages) {
            await this.sendElements(elements, 'split')
        }
    }

    private async sendElements(
        elements: h[],
        mode: RenderStreamMode = this.mode
    ) {
        if (!this.send) return

        const processed = await this.censor(elements)
        if (processed.length < 1) return

        if (mode === 'edit') {
            await this.queue.edit(processed)
            return
        }

        await this.context.send(processed)
    }

    private async censor(elements: h[]) {
        if (!this.config.censor) return elements
        return await this.ctx.censor.transform(elements, this.context.session)
    }
}

class ReplyQueue {
    private messageId: string | null = null
    private current: Fragment | null = null
    private processing = false
    private finished = false

    constructor(private readonly session: Session) {}

    async send(elements: Fragment) {
        const ids = await this.session.bot.sendMessage(
            this.session.channelId,
            elements
        )
        this.messageId = ids[0]
    }

    async edit(elements: Fragment) {
        this.current = elements

        if (this.messageId == null) {
            await this.send(elements)
            return
        }

        if (!this.processing) {
            this.processEditQueue()
        }
    }

    private async processEditQueue() {
        this.processing = true

        let last: Fragment | null = null
        while (!this.finished || this.current !== last) {
            if (this.current == null || this.current === last) break
            last = this.current

            try {
                await this.session.bot.editMessage(
                    this.session.channelId,
                    this.messageId!,
                    last
                )
            } catch (err) {
                logger.error('Error editing message:', err)
            }
        }

        this.processing = false
    }

    async finish() {
        this.finished = true
        while (this.processing) {
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
    }
}
