/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { Context, Schema, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    ctx.on('chatluna/model-added', (service) => {
        ctx.schema.set('model', Schema.union(getModelNames(service)))
    })

    ctx.on('chatluna/model-removed', (service) => {
        ctx.schema.set('model', Schema.union(getModelNames(service)))
    })

    ctx.schema.set('model', Schema.union(getModelNames(ctx.chatluna.platform)))

    if (config.think === true) {
        plugin.registerTool('think', {
            selector(_) {
                return true
            },

            async createTool(params, session) {
                const thinkModel = config.thinkModel

                if (thinkModel != null) {
                    const [platform, model] = parseRawModelName(thinkModel)
                    params.model = await ctx.chatluna.createChatModel(
                        platform,
                        model
                    )
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return new ThinkTool(params.model) as any
            }
        })
    }

    if (config.chat === true) {
        plugin.registerTool('question', {
            selector(history) {
                return true
            },
            alwaysRecreate: true,
            async createTool(params, session) {
                return new QuestionTool(session)
            }
        })
    }

    if (config.send === true) {
        plugin.registerTool('send', {
            selector(history) {
                return true
            },

            async createTool(params, session) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return new SendTool(ctx, session) as any
            },
            alwaysRecreate: true
        })
    }

    function getModelNames(service: PlatformService) {
        return service.getAllModels(ModelType.llm).map((m) => Schema.const(m))
    }
}

export class ThinkTool extends Tool {
    name = 'think'
    description =
        'A tool for deep analysis, structured thinking, and task planning on complex problems.'

    constructor(private _model: ChatLunaChatModel) {
        super()
    }

    private _thinkPrompt = `Analyze the following input comprehensively and create an action plan:

1. Summarize the main problem or task
2. Define a clear goal
3. Outline potential steps or subtasks to achieve the goal
4. For each step, suggest which tools (question, send, think, todos, or others) might be needed and why
5. Identify any assumptions, constraints, or potential challenges

IMPORTANT TOOL PRIORITIES:
- Use 'question' tool FIRST when you need user input or clarification
- Use 'send' tool for ALL user communication (progress updates, results, responses)
- Use 'todos' tool to break down complex tasks into subtasks
- Use 'think' tool for deep analysis when needed

Provide a structured response with a clear goal, action plan, and tool suggestions:

{input}

Think critically and creatively. Be specific about which tools to use for each step. Prioritize question and send tools for user interaction. Your response should be actionable, allowing for immediate execution of the plan using the suggested tools.`

    private _responsePrompt = `Based on the analysis and action plan provided, proceed with the following steps:

1. Review the analysis and action plan carefully.
2. For each step in the plan:
   a. If a tool is suggested, use that tool by calling it with the appropriate input.
   b. If no specific tool is suggested, decide which tool would be most appropriate and use it.
3. After each tool use, evaluate the result and decide on the next action.
4. If you encounter any challenges or need more information, use the 'question' tool to ask the user or the 'think' tool to refine the plan.
5. Continue until you have completed all steps or achieved the defined goal.

CRITICAL REMINDERS:
- ALWAYS use the 'send' tool to communicate with the user (progress updates, results, responses)
- Use the 'question' tool when you need user input or clarification
- Do NOT generate direct responses without using the send tool
- Use the 'todos' tool to break down complex tasks into manageable subtasks

Here's the analysis and action plan:

{analysis}

Proceed with executing this plan, using the suggested tools and your best judgment. Always use the send tool for user communication and provide regular updates on your progress.`

    /** @ignore */
    async _call(input: string): Promise<string> {
        try {
            const thinkPrompt = this._thinkPrompt.replace('{input}', input)
            const response = await this._model.invoke(thinkPrompt)
            let analysis = response.content as string

            if (response.additional_kwargs?.reasoning_content) {
                analysis = response.additional_kwargs[
                    'reasoning_content'
                ] as string
            }

            const finalResponse = this._responsePrompt.replace(
                '{analysis}',
                analysis
            )
            return finalResponse
        } catch (error) {
            return 'An error occurred while processing your request. Please try again.'
        }
    }
}

export class QuestionTool extends Tool {
    name = 'question'
    description = `PRIORITY TOOL: Use this tool FIRST when you need to ask the user for clarification, additional information, or decisions during task execution. This tool should be called before proceeding with any complex operations.

IMPORTANT: Always use this tool when:
- You need more information to complete a task
- You need user confirmation for important decisions
- You want to clarify ambiguous requirements
- You need user input to proceed with the next step

The input is the message or question you want to send to the user, and the output is the user's response. Use this tool proactively to ensure you have all necessary information before proceeding.`

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
    description = `PRIORITY TOOL: Use this tool to communicate with the user during task execution. This is the PRIMARY way to send messages, updates, and results to the user.

CRITICAL: When communicating with the user, ALWAYS use this tool instead of generating direct responses without tool calls. This ensures proper message formatting and delivery.

Use this tool for:
- Providing task progress updates
- Sharing intermediate results
- Sending final results and conclusions
- Communicating any information to the user
- Responding to user requests with results

IMPORTANT: Do NOT generate direct responses without using this tool. Always use the send tool to communicate with the user, especially when tasks are in progress or when providing results.

The input is the message you want to send to the user.`

    constructor(
        private ctx: Context,
        private session: Session
    ) {
        super()
    }

    /** @ignore */
    async _call(input: string) {
        try {
            const elements = (
                await this.ctx.chatluna.renderer.render({
                    content: input
                })
            ).flatMap((message) => {
                const elements = message.element
                if (elements instanceof Array) {
                    return elements
                } else {
                    return [elements]
                }
            })

            await this.session.send(elements)
            return 'Message sent successfully. '
        } catch (error) {
            return 'An error occurred while sending your message. Please try again.'
        }
    }
}
