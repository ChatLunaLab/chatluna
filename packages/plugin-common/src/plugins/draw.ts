/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    fuzzyQuery,
    getMessageContent
} from 'koishi-plugin-chatluna/utils/string'
import { Config } from '..'
import { elementToString } from './command'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'

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
            if (config.drawSelector.length === 0) {
                return true
            }
            return history.some(
                (message) =>
                    message.content != null &&
                    fuzzyQuery(
                        getMessageContent(message.content),
                        config.drawSelector
                    )
            )
        },

        createTool(params) {
            return new DrawTool(config.drawCommand, config.drawPrompt)
        }
    })
}

export class DrawTool extends Tool {
    name = 'draw'

    constructor(
        private drawCommand: string,
        private readonly drawPrompt: string
    ) {
        super({})
    }

    /** @ignore */
    async _call(input: string, _, config: ChatLunaToolRunnable) {
        const session = config.configurable.session

        try {
            const elements = await session.execute(
                this.drawCommand.replace('{prompt}', input),
                true
            )

            await session.send(elements)

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
