import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import {
    checkConversationRoomAvailability,
    fixConversationRoomAvailability
} from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('resolve_model', async (session, context) => {
            const { room } = context.options

            const isAvailable = await checkConversationRoomAvailability(
                ctx,
                room
            )

            if (isAvailable) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            await context.send('检测到当前房间不可用，正在为您自动修复')

            await fixConversationRoomAvailability(ctx, config, room)

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .before('request_model')
    //  .before("lifecycle-request_model")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        resolve_model: never
    }
}
