import { Context, Session } from 'koishi'
import { Config } from '..'
import { Tool } from 'langchain/tools'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatHubPlugin
) {
    /*  if (config.group !== true) {
        return
    } */
    /*  plugin.registerTool('group_manager', async () => {
        return {
            selector(history) {
                return history.some(
                    (item) =>
                        item.content.includes('url') ||
                        item.content.includes('http') ||
                        item.content.includes('request') ||
                        item.content.includes('请求') ||
                        item.content.includes('网页') ||
                        item.content.includes('post')
                )
            },
            tool: requestPostTool
        }
    }) */
}
export class GroupManagerTool extends Tool {
    name = 'requests_get'

    maxOutputLength = 2000

    constructor(public session: Session) {
        super({})
    }

    /** @ignore */
    async _call(input: string) {
        return ''
    }

    description = `A portal to the internet. Use this when you need to get specific content from a website.
  Input should be a url string (i.e. "https://www.google.com"). The output will be the text response of the GET request.`
}
