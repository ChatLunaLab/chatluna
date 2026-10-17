import { Context } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'

const lastChatTimes = new Map<string, number>()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('cooldown_time', async (session, context) => {
            const currentChatTime = Date.now()
            const lastChatTime = lastChatTimes.get(session.channelId) ?? 0

            if (currentChatTime - lastChatTime < config.msgCooldown * 1000) {
                const waitTime =
                    (config.msgCooldown * 1000 -
                        (currentChatTime - lastChatTime)) /
                    1000

                context.message = session.text(
                    'chatluna.cooldown_wait_message',
                    [waitTime.toFixed(1)]
                )

                return ChainMiddlewareRunStatus.STOP
            }
            lastChatTimes.set(session.channelId, currentChatTime)
            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('allow_reply')
        .after('message_delay')
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        cooldown_time: never
    }
}
