import { h, type Session, type Universal, type User } from 'koishi'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/koishi'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'

export interface VirtualSessionRouting {
    platform: string
    selfId: string
    userId: string
    username?: string
    guildId?: string
    channelId?: string
    isDirect: boolean
}

export async function buildVirtualSession(
    bot: Session['bot'],
    routing: VirtualSessionRouting,
    action: {
        message: Parameters<typeof getMessageContent>[0]
        messageName?: string
    }
) {
    const channel = routing.isDirect
        ? await bot.createDirectChannel(routing.userId)
        : {
              id: routing.channelId ?? routing.guildId ?? routing.userId,
              type: 0
          }
    const event: Partial<Universal.Event> = {
        type: 'message',
        platform: routing.platform,
        selfId: routing.selfId,
        timestamp: Date.now(),
        channel,
        guild: routing.guildId == null ? undefined : { id: routing.guildId },
        user: {
            id: routing.userId,
            name: routing.username ?? action.messageName ?? 'trigger'
        },
        message: {
            content: getMessageContent(action.message),
            elements:
                typeof action.message === 'string'
                    ? [h.text(action.message)]
                    : transformMessageContentToElements(action.message)
        }
    }

    const session = bot.session(event)
    const userFields = new Set<User.Field>([
        'id',
        'flag',
        'authority',
        'permissions',
        'locales'
    ])
    bot.ctx.emit('before-attach-user', session, userFields)
    await session.observeUser(userFields)
    return session
}
