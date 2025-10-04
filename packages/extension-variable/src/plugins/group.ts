import { Context, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'

export async function apply(
    ctx: Context,
    config: Config,
    _plugin: ChatLunaPlugin
) {
    if (config.latestMessage !== true) {
        return
    }

    const collector = new MessageCollector(config.latestMessageGroups)

    ctx.on('message', async (session) => {
        await collector.collect(session)
    })

    ctx.chatluna.variable.registerFunction(
        'latest_message',
        async (
            args: string[],
            inputVariables: Record<string, string | (() => string)>,
            session?: Session
        ) => {
            const messageCount = parseInt(args[0]) || 4
            const messages = collector.getMessages(
                session.guildId || session.userId,
                session.userId
            )
            return messages.slice(-messageCount).join('\n\n')
        }
    )
}

class MessageCollector {
    private messages: Record<string, string[]> = {}

    constructor(private readonly groups: string[]) {}

    async collect(session: Session) {
        if (
            this.groups.length > 0 &&
            !this.groups.includes(session.guildId || session.userId)
        ) {
            return
        }

        const collector = this.messages[session.guildId || session.userId] || []
        collector.push(
            `[${session.username}](${session.userId}):${session.content}`
        )
        this.messages[session.guildId || session.userId] = collector
    }

    getMessages(guildId: string, userId: string) {
        return this.messages[guildId || userId] || []
    }
}
