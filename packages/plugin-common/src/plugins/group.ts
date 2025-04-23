import { Tool } from '@langchain/core/tools'
import { Context, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    fuzzyQuery,
    getMessageContent
} from 'koishi-plugin-chatluna/utils/string'
import { Config } from '..'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.group !== true) {
        return
    }

    plugin.registerTool('group_manager_mute', {
        selector(history) {
            return fuzzyQuery(
                getMessageContent(history[history.length - 1].content),
                ['禁言', '解禁', 'mute', '群', '管理', 'group']
            )
        },
        alwaysRecreate: true,
        authorization(session) {
            return config.groupScopeSelector.includes(session.userId)
        },
        async createTool(params, session) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return new GroupManagerMuteTool(session) as any
        }
    })
}

export class GroupManagerMuteTool extends Tool {
    name = 'group_manager_mute'

    constructor(public session: Session) {
        super({})
    }

    /** @ignore */
    async _call(input: string) {
        let [userId, rawTime] = input.split(',')

        if (rawTime === '') {
            rawTime = '60'
        }

        const time = parseInt(rawTime)

        if (time < 0 || isNaN(time)) {
            return `false,"Invalid time ${rawTime}, check your input."`
        }

        const bot = this.session.bot

        try {
            await bot.muteGuildMember(this.session.guildId, userId, time)
        } catch (e) {
            return `false,"${e.message}"`
        }

        return 'true'
    }

    // eslint-disable-next-line max-len
    description = `This plugin mutes a user in a group. It takes the user ID and mute time (in ms), comma-separated, like: 10001,60000. Mute time 0 unmute. It returns the mute status and why, like false,“no permission”.`
}
