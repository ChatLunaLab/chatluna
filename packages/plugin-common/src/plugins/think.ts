/* eslint-disable max-len */
import { StructuredTool, Tool } from '@langchain/core/tools'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import z from 'zod'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.think === true) {
        plugin.registerTool('built_thinking', {
            selector(_) {
                return true
            },

            createTool(params) {
                return new ThinkTool()
            }
        })
    }

    if (config.chat === true) {
        plugin.registerTool('built_question', {
            selector(_) {
                return true
            },

            createTool(params) {
                return new BuiltQuestionTool()
            }
        })

        plugin.registerTool('built_user_confirm', {
            selector(_) {
                return true
            },

            createTool(params) {
                return new BuiltUserConfirmTool()
            }
        })
    }

    if (config.send === true) {
        plugin.registerTool('built_user_toast', {
            selector(history) {
                return true
            },

            createTool(params) {
                return new BuiltUserToastTool(ctx)
            }
        })
    }
}

const GlobalThoughtHistory: ThoughtData[] = []
const GlobalThoughtBranches: Record<string, ThoughtData[]> = {}

export class ThinkTool extends StructuredTool {
    name = 'sequentialthinking'
    description = `A detailed tool for dynamic and reflective problem-solving through thoughts.
This tool helps analyze problems through a flexible thinking process that can adapt and evolve.
Each thought can build on, question, or revise previous insights as understanding deepens.

When to use this tool:
- Breaking down complex problems into steps
- Planning and design with room for revision
- Analysis that might need course correction
- Problems where the full scope might not be clear initially
- Problems that require a multi-step solution
- Tasks that need to maintain context over multiple steps
- Situations where irrelevant information needs to be filtered out

Key features:
- You can adjust total_thoughts up or down as you progress
- You can question or revise previous thoughts
- You can add more thoughts even after reaching what seemed like the end
- You can express uncertainty and explore alternative approaches
- Not every thought needs to build linearly - you can branch or backtrack
- Generates a solution hypothesis
- Verifies the hypothesis based on the Chain of Thought steps
- Repeats the process until satisfied
- Provides a correct answer

Parameters explained:
- thought: Your current thinking step, which can include:
* Regular analytical steps
* Revisions of previous thoughts
* Questions about previous decisions
* Realizations about needing more analysis
* Changes in approach
* Hypothesis generation
* Hypothesis verification
- next_thought_needed: True if you need more thinking, even if at what seemed like the end
- thought_number: Current number in sequence (can go beyond initial total if needed)
- total_thoughts: Current estimate of thoughts needed (can be adjusted up/down)
- is_revision: A boolean indicating if this thought revises previous thinking
- revises_thought: If is_revision is true, which thought number is being reconsidered
- branch_from_thought: If branching, which thought number is the branching point
- branch_id: Identifier for the current branch (if any)
- needs_more_thoughts: If reaching end but realizing more thoughts needed

You should:
1. Start with an initial estimate of needed thoughts, but be ready to adjust
2. Feel free to question or revise previous thoughts
3. Don't hesitate to add more thoughts if needed, even at the "end"
4. Express uncertainty when present
5. Mark thoughts that revise previous thinking or branch into new paths
6. Ignore information that is irrelevant to the current step
7. Generate a solution hypothesis when appropriate
8. Verify the hypothesis based on the Chain of Thought steps
9. Repeat the process until satisfied with the solution
10. Provide a single, ideally correct answer as the final output
11. Only set next_thought_needed to false when truly done and a satisfactory answer is reached`

    schema = z.object({
        thought: z.string().describe('Your current thinking step'),
        nextThoughtNeeded: z
            .boolean()
            .describe('Whether another thought step is needed'),
        thoughtNumber: z
            .number()
            .int()
            .min(1)
            .describe('Current thought number'),
        totalThoughts: z
            .number()
            .int()
            .min(1)
            .describe('Estimated total thoughts needed'),
        isRevision: z
            .boolean()
            .optional()
            .describe('Whether this revises previous thinking'),
        revisesThought: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Which thought is being reconsidered'),
        branchFromThought: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Branching point thought number'),
        branchId: z.string().optional().describe('Branch identifier'),
        needsMoreThoughts: z
            .boolean()
            .optional()
            .describe('If more thoughts are needed')
    })

    constructor() {
        super()
    }

    /** @ignore */
    async _call(input: z.infer<typeof this.schema>): Promise<string> {
        return this.processThought(input)
    }

    private validateThoughtData(input: unknown): ThoughtData {
        const data = input as Record<string, unknown>

        if (!data.thought || typeof data.thought !== 'string') {
            throw new Error('Invalid thought: must be a string')
        }
        if (!data.thoughtNumber || typeof data.thoughtNumber !== 'number') {
            throw new Error('Invalid thoughtNumber: must be a number')
        }
        if (!data.totalThoughts || typeof data.totalThoughts !== 'number') {
            throw new Error('Invalid totalThoughts: must be a number')
        }
        if (typeof data.nextThoughtNeeded !== 'boolean') {
            throw new Error('Invalid nextThoughtNeeded: must be a boolean')
        }

        return {
            thought: data.thought,
            thoughtNumber: data.thoughtNumber,
            totalThoughts: data.totalThoughts,
            nextThoughtNeeded: data.nextThoughtNeeded,
            isRevision: data.isRevision as boolean | undefined,
            revisesThought: data.revisesThought as number | undefined,
            branchFromThought: data.branchFromThought as number | undefined,
            branchId: data.branchId as string | undefined,
            needsMoreThoughts: data.needsMoreThoughts as boolean | undefined
        }
    }

    private formatThought(thoughtData: ThoughtData): string {
        const {
            thoughtNumber,
            totalThoughts,
            thought,
            isRevision,
            revisesThought,
            branchFromThought,
            branchId
        } = thoughtData

        let prefix = ''
        let context = ''

        if (isRevision) {
            prefix = '[REVISION]'
            context = ` (revising thought ${revisesThought})`
        } else if (branchFromThought) {
            prefix = '[BRANCH]'
            context = ` (from thought ${branchFromThought}, ID: ${branchId})`
        } else {
            prefix = '[THOUGHT]'
            context = ''
        }

        const header = `${prefix} ${thoughtNumber}/${totalThoughts}${context}`
        const border = '-'.repeat(Math.max(header.length, thought.length) + 4)

        return `
+${border}+
| ${header} |
+${border}+
| ${thought.padEnd(border.length - 2)} |
+${border}+`
    }

    public processThought(input: unknown) {
        try {
            const validatedInput = this.validateThoughtData(input)

            if (validatedInput.thoughtNumber > validatedInput.totalThoughts) {
                validatedInput.totalThoughts = validatedInput.thoughtNumber
            }

            GlobalThoughtHistory.push(validatedInput)

            if (validatedInput.branchFromThought && validatedInput.branchId) {
                if (!GlobalThoughtBranches[validatedInput.branchId]) {
                    GlobalThoughtBranches[validatedInput.branchId] = []
                }
                GlobalThoughtBranches[validatedInput.branchId].push(
                    validatedInput
                )
            }

            const formattedThought = this.formatThought(validatedInput)
            console.error(formattedThought)

            return JSON.stringify(
                {
                    thoughtNumber: validatedInput.thoughtNumber,
                    totalThoughts: validatedInput.totalThoughts,
                    nextThoughtNeeded: validatedInput.nextThoughtNeeded,
                    branches: Object.keys(GlobalThoughtBranches),
                    thoughtHistoryLength: GlobalThoughtHistory.length
                },
                null,
                2
            )
        } catch (error) {
            return JSON.stringify(
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    status: 'failed'
                },
                null,
                2
            )
        }
    }
}

export class BuiltQuestionTool extends StructuredTool {
    name = 'built_question'
    description = `Use this tool when you have identified potential solutions and need the user to choose between 2-4 specific options. This tool is designed for situations where you know the possible approaches but need user preference to proceed.

When to use:
- You have 2-4 specific solution options and need user selection
- Multiple valid approaches exist and user preference matters
- You need the user to choose between predefined alternatives
- The solutions are well-defined and you're confident in the options

Do NOT use this tool when:
- You're uncertain about the approach and need general guidance
- You need open-ended user input
- You have only one solution option`

    schema = z.object({
        question: z
            .string()
            .describe(
                'The question or problem you want the user to choose a solution for'
            ),
        options: z
            .array(z.string())
            .min(2)
            .max(4)
            .describe(
                'Array of 2-4 specific solution options for the user to choose from'
            )
    })

    constructor() {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        config: ChatLunaToolRunnable
    ) {
        const { question, options } = input

        const session = config.configurable.session

        let message = question + '\n\n'
        options.forEach((option, index) => {
            message += `${index + 1}. ${option}\n`
        })
        message += '\n请选择一个选项（输入数字）：'

        await session.send(message)

        try {
            const result = await session.prompt()
            const choice = parseInt(result.trim())

            if (choice >= 1 && choice <= options.length) {
                return `用户选择了选项 ${choice}: ${options[choice - 1]}`
            } else {
                return `用户选择无效，原始回复: ${result}`
            }
        } catch (error) {
            return 'An error occurred while requesting user input. Please stop the tool call.'
        }
    }
}

export class BuiltUserConfirmTool extends Tool {
    name = 'built_user_confirm'
    description = `Use this tool when you're uncertain about the approach and need open-ended user input or guidance. This tool is for situations where you need the user to provide new direction, clarification, or additional information.

When to use:
- You're uncertain about which approach to take
- You need open-ended user feedback or guidance
- You need clarification on ambiguous requirements
- You need additional information to proceed
- You want user confirmation for important decisions

Do NOT use this tool when:
- You have specific solution options and just need user selection (use built_question instead)
- You're just providing updates (use built_user_toast instead)`

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

export class BuiltUserToastTool extends Tool {
    name = 'built_user_toast'
    description = `Use this tool to notify the user about task changes, progress updates, or new developments during task execution. This is specifically for informational updates and notifications.

When to use:
- Task status has changed or progressed
- New developments or findings during execution
- Intermediate results that don't require user response
- Progress notifications during long-running tasks
- Completion notifications

Do NOT use this tool when:
- You need user input or confirmation (use built_user_confirm instead)
- You need user to choose between options (use built_question instead)
- Sending final results that end the conversation`

    constructor(private ctx: Context) {
        super()
    }

    /** @ignore */
    async _call(input: string, _, config: ChatLunaToolRunnable) {
        const session = config.configurable.session

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

            await session.send(elements)
            return 'Message sent successfully. '
        } catch (error) {
            return 'An error occurred while sending your message. Please try again.'
        }
    }
}

interface ThoughtData {
    thought: string
    thoughtNumber: number
    totalThoughts: number
    isRevision?: boolean
    revisesThought?: number
    branchFromThought?: number
    branchId?: string
    needsMoreThoughts?: boolean
    nextThoughtNeeded: boolean
}
