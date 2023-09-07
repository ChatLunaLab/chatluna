import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { switchConversationRoom } from '../chains/rooms';


const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("switch_room", async (session, context) => {

        const { command } = context

        if (command !== "switch_room") return ChainMiddlewareRunStatus.SKIPPED

        const targetConversationRoom = await switchConversationRoom(ctx, session, context.options.room_resolve?.name)

        context.message = `已切换到房间 ${targetConversationRoom.roomName}`

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}


declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "switch_room": never
    }

}