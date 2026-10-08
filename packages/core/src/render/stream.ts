import type { Context, Fragment, h, Logger, Session } from 'koishi'
import type { ChainMiddlewareContext } from '../chains/chain'
import type { Config } from '../config'
import type { Message, RenderMessage, RenderOptions } from '../types'
import type { Renderer } from './base'
import type { RenderStreamMode, RenderStreamSession, ReplyFrame } from './types'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { censorMessage } from '../middlewares/chat/censor'

export interface ReplyStreamOptions {
    enabled: boolean
    send?: boolean
    censor?: boolean
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
    private moderated: boolean
    private pending: Message[] = []
    private renderMessage: (message: Message) => Promise<RenderMessage[]>
    private renderAdditional?: (message: Message) => Promise<h[][]>

    constructor(
        private readonly ctx: Context,
        config: Config,
        private readonly context: ChainMiddlewareContext,
        private readonly renderer: Renderer,
        opts: ReplyStreamOptions
    ) {
        logger = createLogger(ctx)
        this.moderated = config.censor || opts.censor === true
        const options = {
            ...opts.renderOptions,
            session:
                context.options.deliverySession ??
                opts.renderOptions?.session ??
                context.session
        } as RenderOptions
        const plan =
            opts.enabled && !this.moderated
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
            if (this.closed || this.mode === 'buffer') return

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
            if (this.moderated) {
                this.pending.push({ content: frame.content ?? frame.name })
                return
            }
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

        // Chunk-end signals can arrive before the final post-processed reply.
        if (this.moderated && this.finalMessage == null) return

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

        for (const message of this.pending) {
            await this.sendMessage(message, 'split')
        }
        this.pending = []

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
        const messages = await this.renderMessage(await this.censor(message))
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

        let message = this.finalMessage
        if (this.moderated && message.additionalReplyMessages != null) {
            message = {
                ...message,
                additionalReplyMessages: await Promise.all(
                    message.additionalReplyMessages.map((msg) =>
                        this.censor(msg)
                    )
                )
            }
        }
        const messages = await this.renderAdditional(message)
        for (const elements of messages) {
            await this.sendElements(elements, 'split')
        }
    }

    private async sendElements(
        elements: h[],
        mode: RenderStreamMode = this.mode
    ) {
        if (!this.send) return

        if (elements.length < 1) return

        if (mode === 'edit') {
            return await this.queue.edit(elements)
        }

        await this.context.send([elements])
    }

    private async censor(message: Message) {
        if (!this.moderated) return message
        return await censorMessage(
            this.ctx,
            message,
            this.context.options.deliverySession ?? this.context.session
        )
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
