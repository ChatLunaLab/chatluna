import { Context, Session } from 'koishi'
import { Config } from '..'
import { Tool } from 'langchain/tools'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { fuzzyQuery } from '@dingyi222666/koishi-plugin-chathub/lib/utils/string'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatHubPlugin
) {
    if (config.group !== true) {
        return
    }
    plugin.registerTool('group_manager_mute', {
        selector(history) {
            return fuzzyQuery(history[history.length - 1].content, [
                '禁言',
                '解禁',
                'mute',
                '群',
                '管理',
                'group'
            ])
        },
        alwaysRecreate: true,
        authorization(session) {
            return config.groupScopeSelector.includes(session.userId)
        },
        async createTool(params, session) {
            return new GroupManagerMuteTool(session)
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
    description = `A group management mute plugin, which can be used to mute a user. The input is the current user’s ID and mute time (in milliseconds), separated by a comma, such as: 10001,60000. Unmuted when mute time is 0. Return the mute result and reason, such as false,"no permission"`
}
