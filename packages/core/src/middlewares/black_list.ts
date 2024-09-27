import { Context, Logger } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'

let logger: Logger

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    logger = createLogger(ctx)
    chain
        .middleware('black_list', async (session, context) => {
            const resolved = await session.resolve(config.blackList)
            if (resolved === true) {
                logger.debug(
                    `[黑名单] ${session.username}(${session.userId}): ${session.content}`
                )
                context.message = session.text('chatluna.block_message')
                return ChainMiddlewareRunStatus.STOP
            }
            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('allow_reply')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        black_list: never
    }
}
