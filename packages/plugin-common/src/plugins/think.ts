import { Context, Session } from 'koishi'
import { Config } from '..'
import { Tool } from 'langchain/tools'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatHubPlugin
) {
    await plugin.registerTool('think', {
        selector(history) {
            return true
        },

        async createTool(params, session) {
            return new ThinkTool()
        }
    })

    if (config.chat !== true) {
        return
    }

    await plugin.registerTool('chat', {
        selector(history) {
            return true
        },
        alwaysRecreate: true,
        async createTool(params, session) {
            return new ChatTool(session)
        }
    })
}
export class ThinkTool extends Tool {
    name = 'think'

    constructor() {
        super({})
    }

    /** @ignore */
    async _call(input: string) {
        return input
    }

    // eslint-disable-next-line max-len
    description = `Tools for staging the results of your thinking when a user requests that you need to think before invoking a tool. You should store the results in this tool.`
}

export class ChatTool extends Tool {
    name = 'chat'

    constructor(private session: Session) {
        super({})
    }

    /** @ignore */
    async _call(input: string) {
        await this.session.send(input)

        return await this.session.prompt()
    }

    // eslint-disable-next-line max-len
    description = `Called when a user is needed to make a decision about something, the input is what you need to let the user know and the output is the user's output.`
}
