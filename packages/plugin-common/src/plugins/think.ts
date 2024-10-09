import { Tool } from '@langchain/core/tools'
import { Context, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.think === true) {
        await plugin.registerTool('think', {
            selector(_) {
                return true
            },

            async createTool(params, session) {
                return new ThinkTool()
            }
        })
    }

    if (config.chat !== true) {
        return
    }

    plugin.registerTool('chat', {
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
        return `OK, This is your think content: ${input}. You need to continue.`
    }

    // eslint-disable-next-line max-len
    description = `A tool for organizing and storing intermediate thoughts or reasoning steps. Use this when you need to break down complex problems, brainstorm ideas, or structure your thinking process before taking further actions or using other tools.`
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
    description = `A tool for interacting with the user. Use this when you need to ask the user for input, clarification, or a decision. The input is the message or question you want to send to the user, and the output is the user's response.`
}
