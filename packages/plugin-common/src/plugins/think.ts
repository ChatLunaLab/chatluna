/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { Context, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.think === true) {
        plugin.registerTool('think', {
            selector(_) {
                return true
            },

            async createTool(params, session) {
                return new ThinkTool(params.model)
            }
        })
    }

    if (config.chat === true) {
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

    if (config.send === true) {
        plugin.registerTool('send', {
            selector(history) {
                return true
            },
            async createTool(params, session) {
                return new SendTool(session)
            },
            alwaysRecreate: true
        })
    }
}

export class ThinkTool extends Tool {
    name = 'think'
    description =
        'A tool for deep analysis and structured thinking on complex problems.'

    constructor(private _model: ChatLunaChatModel) {
        super()
    }

    private _thinkPrompt = `Analyze the following input comprehensively:

1. Summarize key points
2. Identify assumptions
3. Break down the problem
4. Consider multiple perspectives
5. Analyze potential outcomes
6. Identify information gaps
7. Synthesize and propose solutions
8. Reflect on your analysis
9. Suggest follow-up actions

Provide a structured, in-depth response:

{input}

Think critically and creatively. Explore thoroughly before concluding.`

    /** @ignore */
    async _call(input: string): Promise<string> {
        const prompt = this._thinkPrompt.replace('{input}', input)

        try {
            const response = await this._model.invoke(prompt)
            return response.content as string
        } catch (error) {
            return 'An error occurred while processing your request. Please try again.'
        }
    }
}

export class ChatTool extends Tool {
    name = 'chat'
    description = `A tool for interacting with the user. Use this when you need to ask the user for input, clarification, or a decision. The input is the message or question you want to send to the user, and the output is the user's response. Only use this tool when absolutely necessary for task completion. If the user requests to stop interactions or if you have sufficient information to proceed, avoid using this tool and provide a direct response or result instead.`

    constructor(private session: Session) {
        super()
    }

    /** @ignore */
    async _call(input: string) {
        await this.session.send(input)

        try {
            const result = await this.session.prompt()
            return result
        } catch (error) {
            return 'An error occurred while requesting user input. Please stop the tool call.'
        }
    }
}

export class SendTool extends Tool {
    name = 'send'
    description =
        'A tool for sending messages to the user. Use this when you want to communicate information, results, or responses directly to the user without expecting a reply. The input is the message you want to send.'

    constructor(private session: Session) {
        super()
    }

    /** @ignore */
    async _call(input: string) {
        try {
            await this.session.send(input)
            return 'Message sent successfully.'
        } catch (error) {
            return 'An error occurred while sending your message. Please try again.'
        }
    }
}
