import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../llm-core/utils/logger';
import { getAllJoinedConversationRoom, switchConversationRoom } from '../chains/rooms';
import { ConversationRoom } from '../types';


const logger = createLogger("@dingyi222666/chathub/middlewares/switch_room")

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("switch_room", async (session, context) => {

        const { command } = context

        if (command !== "switchRoom") return ChainMiddlewareRunStatus.SKIPPED

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