import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { switchConversationRoom } from '../chains/rooms'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('switch_room', async (session, context) => {
            const { command } = context

            if (command !== 'switch_room')
                return ChainMiddlewareRunStatus.SKIPPED

            const targetConversationRoom = await switchConversationRoom(
                ctx,
                session,
                context.options.room_resolve?.name
            )

            if (!targetConversationRoom) {
                context.message = session.text('.room_not_found')
                return ChainMiddlewareRunStatus.STOP
            }

            context.message = session.text('.success', [
                targetConversationRoom.roomName
            ])

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        switch_room: never
    }
}
