/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { Context, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    fuzzyQuery,
    getMessageContent
} from 'koishi-plugin-chatluna/utils/string'
import { Config } from '..'
import { elementToString } from './command'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.draw !== true) {
        return
    }

    plugin.registerTool('draw', {
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
            return new DrawTool(
                session,
                config.drawCommand,
                config.drawPrompt
                // eslint-disable-next-line prettier/prettier, @typescript-eslint/no-explicit-any
            ) as any
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
            const elements = await this.session.execute(
                this.drawCommand.replace('{prompt}', input),
                true
            )

            await this.session.send(elements)

            return `Successfully call draw with result ${elementToString(elements)}`
        } catch (e) {
            return `Draw image with prompt ${input} execution failed, because ${e.message}`
        }
    }

    // eslint-disable-next-line max-len
    get description() {
        return this.rawDescription.replace(/\{\{prompts}}/g, this.drawPrompt)
    }

    private rawDescription = `This tool generates images from text prompts. The AI cannot view the images, but users can receive them. Use the following prompt examples as a guide: {{prompts}}

    Based on these examples, create high-quality English prompts that match the user's requests. The tool's only input is the prompt text.`
}
