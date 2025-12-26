import { Context } from 'koishi'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { Config } from '../../config'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('reply_queue', async (session, context) => {
            if (!config.queueAtMessages) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            if (context.command?.length > 0 || context.options.queueBypass) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            const { room, inputMessage, replyStatus } = context.options

            if (!room?.conversationId || inputMessage == null) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            const wrapper = ctx.chatluna.getCachedInterfaceWrapper()
            if (!wrapper?.isReplying(room.conversationId)) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            if (inputMessage.name == null) {
                inputMessage.name =
                    session.author?.name ??
                    session.author?.id ??
                    session.username
            }

            wrapper.enqueueQueuedMessage(
                room.conversationId,
                inputMessage,
                session,
                room,
                replyStatus === true
            )

            return ChainMiddlewareRunStatus.STOP
        })
        .after('message_delay')
        .before('lifecycle-handle_command')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        reply_queue: never
    }

    interface ChainMiddlewareContextOptions {
        queueBypass?: boolean
    }
}
