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
    private closed = false
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
            session:
                context.options.deliverySession ??
                opts.renderOptions?.session ??
                context.session
        } as RenderOptions
        const plan = opts.enabled
            ? renderer.getStreamPlan(options)
            : { mode: 'buffer' as const }

        this.mode = plan.mode
        this.stream = renderer.createStreamSession(options, plan)
        this.queue = new ReplyQueue(
            context.options.deliverySession ?? context.session
        )
        this.send = opts.send !== false
        this.renderMessage =
            opts.renderMessage ??
            (async (message) => [await this.renderer.render(message, options)])
        this.renderAdditional = opts.renderAdditional
    }

    async write(frame: ReplyFrame) {
        if (frame.type === 'content') {
            if (this.closed) return

            if (this.firstChunk) {
                this.firstChunk = false
                await this.context.recallThinkingMessage?.()
            }

            const elements = await this.stream.write(frame.chunk)
            if (elements != null && elements.length > 0) {
                await this.sendElements(elements)
            }
            return
        }

        if (frame.type === 'mark' && frame.instant) {
            await this.sendMessage(
                { content: frame.content ?? frame.name },
                'split'
            )
            return
        }

        if (frame.type === 'done') {
            this.finalMessage = frame.message
            return
        }

        if (frame.type === 'error') {
            await this.context.recallThinkingMessage?.()
            await this.queue.finish()
            throw frame.error
        }
    }

    async end(frame?: ReplyFrame) {
        if (frame != null) {
            await this.write(frame)
        }

        if (frame?.type === 'done' && this.mode === 'split' && !this.closed) {
            return
        }

        if (this.closed) {
            if (frame?.type === 'done') {
                if (this.mode === 'edit') {
                    await this.sendMessage(frame.message, 'edit')
                } else if (this.mode === 'buffer' || this.firstChunk) {
                    await this.sendMessage(frame.message, 'split')
                }
            }
            return await this.finish()
        }

        this.closed = true

        await this.context.recallThinkingMessage?.()

        if (this.mode === 'buffer') {
            if (this.finalMessage != null) {
                await this.sendMessage(this.finalMessage, 'split')
            }
            return await this.finish()
        }

        if (this.mode === 'edit' && this.finalMessage != null) {
            await this.sendMessage(this.finalMessage, 'edit')
        } else {
            const elements = await this.stream.flush()
            if (elements != null && elements.length > 0) {
                await this.sendElements(elements)
            } else if (this.firstChunk && this.finalMessage != null) {
                await this.sendMessage(this.finalMessage, 'split')
            }
        }

        await this.finish()
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
        if (this.finalMessage == null || this.renderAdditional == null) return
        this.sentAdditional = true

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
            return await this.queue.edit(processed)
        }

        await this.context.send([processed])
    }

    private async censor(elements: h[]) {
        if (!this.config.censor) return elements
        const session =
            this.context.options.deliverySession ?? this.context.session
        return await this.ctx.censor.transform(elements, session)
    }

    private async finish() {
        await this.sendAdditional()
        await this.queue.finish()
    }
}

class ReplyQueue {
    private messageId: string | null = null
    private current: Fragment | null = null
    private queue: Promise<void> = Promise.resolve()

    constructor(private readonly session: Session) {}

    edit(elements: Fragment) {
        this.current = elements
        this.queue = this.queue.then(() => this.dispatch())
        return this.queue
    }

    private async dispatch() {
        if (this.current == null) return
        const current = this.current
        this.current = null

        try {
            if (this.messageId == null) {
                const ids = await this.session.bot.sendMessage(
                    this.session.channelId,
                    current
                )
                this.messageId = ids[0]
            } else {
                await this.session.bot.editMessage(
                    this.session.channelId,
                    this.messageId!,
                    current
                )
            }
        } catch (err) {
            logger.error('Error editing message:', err)
        }
    }

    finish() {
        return this.queue
    }
}
