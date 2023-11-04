import { Context } from 'koishi'
import { Config } from '..'
import { Tool } from 'langchain/tools'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatHubPlugin
) {
    if (config.group !== true) {
        return
    }
    plugin.registerTool('think', {
        selector(history) {
            return true
        },

        async createTool(params, session) {
            return new ThinkTool()
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
