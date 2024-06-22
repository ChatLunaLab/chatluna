/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { Context, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { fuzzyQuery, getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { Config } from '..'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.draw !== true) {
        return
    }

    await plugin.registerTool('draw', {
        selector(history) {
            return history.some(
                (message) =>
                    message.content != null &&
                    fuzzyQuery(getMessageContent(message.content), [
                        '画',
                        'image',
                        'sd',
                        '图',
                        '绘',
                        'draw'
                    ])
            )
        },
        alwaysRecreate: false,

        async createTool(params, session) {
            return new DrawTool(session, config.drawCommand, config.drawPrompt)
        }
    })
}

export class DrawTool extends Tool {
    name = 'draw'

    constructor(
        public session: Session,
        private drawCommand: string,
        private readonly drawPrompt: string
    ) {
        super({})
    }

    /** @ignore */
    async _call(input: string) {
        try {
            await this.session.execute(
                this.drawCommand.replace('{prompt}', input)
            )
            return `Successfully call draw with prompt ${input}`
        } catch (e) {
            return `Draw image with prompt ${input} execution failed, because ${e.message}`
        }
    }

    // eslint-disable-next-line max-len
    get description() {
        return this.rawDescription.replace(/\{\{prompts}}/g, this.drawPrompt)
    }

    private rawDescription = `This tool is can generates images from prompts. The images cannot be read by the model, but the user can receive them. You need to follow the examples of prompts below: {{prompts}} \nNow you need to learn the relationship between the user’s needs and the prompts above by yourself, and then generate high-quality English prompts based on these prompts. The only input for this tool is the prompt.`
}
