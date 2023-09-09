import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { createLogger } from '../utils/logger'
import { checkAdmin, getConversationRoomUser, joinConversationRoom } from '../chains/rooms'

const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('invite_room', async (session, context) => {
            const { command } = context

            if (command !== 'invite_room') return ChainMiddlewareRunStatus.SKIPPED

            const targetRoom = context.options.room

            if (targetRoom == null) {
                context.message = '你没有在当前环境里指定房间。请使用 chathub.room.switch 命令来切换房间'
                return ChainMiddlewareRunStatus.STOP
            }

            const userInfo = await getConversationRoomUser(ctx, session, targetRoom, session.userId)

            if (userInfo.roomPermission === 'member' && !(await checkAdmin(session))) {
                context.message = `你不是房间 ${targetRoom.roomName} 的管理员，无法邀请用户加入。`
                return ChainMiddlewareRunStatus.STOP
            }

            const targetUser = context.options.resolve_user.id as string[]

            for (const user of targetUser) {
                await joinConversationRoom(ctx, session, targetRoom, session.isDirect, user)
            }

            context.message = `已邀请用户 ${targetUser.join(',')} 加入房间 ${targetRoom.roomName}`

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        invite_room: never
    }

    interface ChainMiddlewareContextOptions {
        resolve_user?: {
            id: string | string[]
        }
    }
}
