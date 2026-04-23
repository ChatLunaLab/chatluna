import { h, type Session, type Universal } from 'koishi'
import { transformMessageContentToElements } from 'koishi-plugin-chatluna/utils/koishi'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import type { WakeupAction, WakeupRouting } from '../types'

export function buildVirtualSession(
    bot: Session['bot'],
    routing: WakeupRouting,
    action: Pick<WakeupAction, 'message' | 'messageName' | 'requestId'>
) {
    const event: Partial<Universal.Event> = {
        type: 'message',
        platform: routing.platform,
        selfId: routing.selfId,
        timestamp: Date.now(),
        channel: {
            id: routing.channelId ?? routing.guildId ?? routing.userId,
            type: routing.isDirect ? 1 : 0
        },
        guild: routing.guildId == null ? undefined : { id: routing.guildId },
        user: {
            id: routing.userId,
            name: action.messageName ?? 'trigger'
        },
        message: {
            id: action.requestId,
            content: getMessageContent(action.message),
            elements:
                typeof action.message === 'string'
                    ? [h.text(action.message)]
                    : transformMessageContentToElements(action.message)
        }
    }

    return bot.session(event)
}
