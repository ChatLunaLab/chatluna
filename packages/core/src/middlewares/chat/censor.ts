import { h } from 'koishi'
import type { Context, Session } from 'koishi'
import type { Config } from '../../config'
import { ChainMiddlewareRunStatus } from '../../chains/chain'
import type { ChatChain } from '../../chains/chain'
import type {} from '@koishijs/censor'
import type { Message } from '../../types'
import { isMessageContentText } from '../../utils/langchain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('censor', async (session, context) => {
            const message = context.options.responseMessage

            if (!config.censor || message == null) {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            message.content = (
                await censorMessage(
                    ctx,
                    message,
                    context.options.deliverySession ?? session
                )
            ).content
            return ChainMiddlewareRunStatus.CONTINUE
        })
        .before('lifecycle-send')
        .after('lifecycle-request_conversation')
}

export async function censorMessage(
    ctx: Context,
    msg: Message,
    session: Session
): Promise<Message> {
    if (typeof msg.content === 'string') {
        const text = await ctx.censor.transform([h.text(msg.content)], session)
        return { ...msg, content: h.unescape(text.join('')) }
    }

    const parts: Exclude<Message['content'], string> = []
    for (const el of msg.content) {
        const prev = parts[parts.length - 1]
        if (prev && isMessageContentText(prev) && isMessageContentText(el)) {
            prev.text += el.text
            continue
        }
        parts.push(isMessageContentText(el) ? { ...el } : el)
    }

    const content = await Promise.all(
        parts.map(async (el) => {
            if (!isMessageContentText(el)) return el
            const text = await ctx.censor.transform([h.text(el.text)], session)
            el.text = h.unescape(text.join(''))
            return el
        })
    )
    return { ...msg, content }
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        censor: never
    }
}
