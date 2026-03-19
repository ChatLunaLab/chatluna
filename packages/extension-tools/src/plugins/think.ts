/* eslint-disable max-len */
import { StructuredTool, Tool } from '@langchain/core/tools'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import z from 'zod'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'

export async function apply(
    _ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.chat === true) {
        plugin.registerTool('question', {
            description: new BuiltQuestionTool().description,
            selector(_) {
                return true
            },

            createTool(params) {
                return new BuiltQuestionTool()
            }
        })

        plugin.registerTool('user_confirm', {
            description: new BuiltUserConfirmTool().description,
            selector(_) {
                return true
            },

            createTool(params) {
                return new BuiltUserConfirmTool()
            }
        })
    }
}

const QuestionOptionSchema = z.object({
    label: z.string().describe('Display text (1-5 words, concise)'),
    description: z.string().describe('Explanation of choice')
})

const QuestionItemSchema = z.object({
    question: z.string().describe('Complete question'),
    header: z.string().describe('Very short label (max 30 chars)'),
    options: z.array(QuestionOptionSchema).describe('Available choices'),
    multiple: z
        .boolean()
        .optional()
        .describe('Allow selecting multiple choices')
})

export class BuiltQuestionTool extends StructuredTool {
    name = 'question'
    description = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- A "Type your own answer" option is always available; don't include "Other" or catch-all options
- The user can type their own answer or choose from the provided options by entering the option number
- If the user replies with an empty string, the first option (default) is selected automatically
- Answers are returned as arrays of labels; set \`multiple: true\` to allow selecting more than one
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`

    schema = z.object({
        questions: z.array(QuestionItemSchema).describe('Questions to ask')
    })

    constructor() {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        config: ChatLunaToolRunnable
    ) {
        const { questions } = input
        const session = config.configurable.session
        const results: string[] = []

        for (const item of questions) {
            const { question, header, options, multiple } = item

            let message = `[${header}] ${question}\n\n`
            options.forEach((option, index) => {
                message += `${index + 1}. ${option.label} — ${option.description}\n`
            })
            message += `\n（输入选项编号选择，多个用逗号分隔；不输入编号则代表输入自定义答案；回车选择默认项）`

            await session.send(message)

            try {
                const raw = await session.prompt()
                const trimmed = raw?.trim() ?? ''

                // Empty input -> select default (first option)
                if (trimmed === '') {
                    results.push(
                        `[${header}] 用户选择了默认项: ${options[0].label}`
                    )
                    continue
                }

                // Try to parse as option number(s)
                const parts = trimmed.split(',').map((s) => s.trim())
                const indices = parts
                    .map((p) => parseInt(p))
                    .filter((n) => !isNaN(n) && n >= 1 && n <= options.length)

                if (indices.length > 0) {
                    if (multiple) {
                        const chosen = indices.map((i) => options[i - 1].label)
                        results.push(
                            `[${header}] 用户选择了: ${chosen.join(', ')}`
                        )
                    } else {
                        const chosen = options[indices[0] - 1].label
                        results.push(`[${header}] 用户选择了: ${chosen}`)
                    }
                } else {
                    // Custom answer
                    results.push(`[${header}] 用户自定义回复: ${trimmed}`)
                }
            } catch (error) {
                results.push(
                    `[${header}] An error occurred while requesting user input.`
                )
            }
        }

        return results.join('\n')
    }
}

export class BuiltUserConfirmTool extends Tool {
    name = 'user_confirm'
    description = `Use this tool when you're uncertain about the approach and need open-ended user input or guidance. This tool is for situations where you need the user to provide new direction, clarification, or additional information.

When to use:
- You're uncertain about which approach to take
- You need open-ended user feedback or guidance
- You need clarification on ambiguous requirements
- You need additional information to proceed
- You want user confirmation for important decisions

Do NOT use this tool when:
- You have specific solution options and just need user selection (use built_question instead)
- You're just providing updates or notifications`

    constructor() {
        super()
    }

    async _call(input: string, _, config: ChatLunaToolRunnable) {
        const session = config.configurable.session

        await session.send(input)

        try {
            const result = await session.prompt()
            return result
        } catch (error) {
            return 'An error occurred while requesting user input. Please stop the tool call.'
        }
    }
}
