/* eslint-disable max-len */
import { StructuredTool } from '@langchain/core/tools'
import { HumanMessage } from '@langchain/core/messages'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { z } from 'zod'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { PromptContextRuntime } from 'koishi-plugin-chatluna/llm-core/prompt'

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
type TodoPriority = 'high' | 'medium' | 'low'

interface Todo {
    content: string
    status: TodoStatus
    priority: TodoPriority
}

const todosStore = new Map<string, Todo[]>()

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.todos !== true) {
        return
    }

    plugin.registerTool('todos', {
        description: new TodosTool(ctx, config).description,
        selector() {
            return true
        },
        meta: {
            defaultMain: true,
            defaultChatluna: false,
            defaultCharacter: false,
            defaultCharacterGroup: false,
            defaultCharacterPrivate: false
        },
        createTool(params) {
            return new TodosTool(ctx, config)
        }
    })

    // Register a pipeline middleware at 'after_scratchpad' stage to inject
    // the current todo state directly after the user message.
    const contextManager = ctx.chatluna.contextManager
    contextManager.pipeline(
        'after_scratchpad',
        async (runtime: PromptContextRuntime, next) => {
            const conversationId = runtime.configurable?.conversationId
            if (!conversationId) return next()

            const todos = todosStore.get(conversationId)
            if (!todos || todos.length === 0) return next()

            const content = renderTodos(todos)
            runtime.result.push(new HumanMessage(content))

            return next()
        },
        10
    )

    ctx.on('chatluna/clear-chat-history', async (conversationId) => {
        todosStore.delete(conversationId)
    })
}

export class TodosTool extends StructuredTool {
    name = 'todos'

    schema = z.object({
        todos: z
            .array(
                z.object({
                    content: z
                        .string()
                        .describe('Brief description of the task'),
                    status: z
                        .enum([
                            'pending',
                            'in_progress',
                            'completed',
                            'cancelled'
                        ])
                        .describe(
                            'Current status of the task: pending, in_progress, completed, cancelled'
                        ),
                    priority: z
                        .enum(['high', 'medium', 'low'])
                        .describe(
                            'Priority level of the task: high, medium, low'
                        )
                })
            )
            .describe('The updated todo list')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any

    constructor(
        private readonly ctx: Context,
        private readonly config: Config
    ) {
        super({})
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        toolConfig: ChatLunaToolRunnable
    ) {
        const { todos } = input as { todos: Todo[] }
        const conversationId = toolConfig.configurable.conversationId
        const session = toolConfig.configurable.session

        // Update the todo list for this conversation
        todosStore.set(conversationId, todos)

        // Send notification if enabled
        if (this.config.todosNotify && session) {
            const lines = todos.map((todo) => {
                const icon =
                    todo.status === 'completed'
                        ? '[x]'
                        : todo.status === 'in_progress'
                          ? '[~]'
                          : todo.status === 'cancelled'
                            ? '[-]'
                            : '[ ]'
                return `${icon} ${todo.content}`
            })
            const completedCount = todos.filter(
                (t) => t.status === 'completed' || t.status === 'cancelled'
            ).length
            await session.send(
                lines.join('\n') +
                    `\n${completedCount}/${todos.length} tasks completed`
            )
        }

        const inProgressCount = todos.filter(
            (t: Todo) => t.status === 'in_progress'
        ).length
        const completedCount = todos.filter(
            (t: Todo) => t.status === 'completed' || t.status === 'cancelled'
        ).length
        const pendingCount = todos.filter(
            (t: Todo) => t.status === 'pending'
        ).length

        return JSON.stringify({
            success: true,
            total: todos.length,
            pending: pendingCount,
            in_progress: inProgressCount,
            completed: completedCount
        })
    }

    description = `Use this tool to create and manage a structured task list for your current session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multistep tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos. Feel free to edit the todo list based on new information.
6. After completing a task - Mark it complete and add any new follow-up tasks
7. When you start working on a new task, mark the todo as in_progress. Ideally you should only have one todo as in_progress at a time. Complete existing tasks before starting new ones.

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully
   - cancelled: Task no longer needed

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Only have ONE task in_progress at any time
   - Complete current tasks before starting new ones
   - Cancel tasks that become irrelevant

3. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names

When in doubt, use this tool. Being proactive with task management ensures you complete all requirements successfully.

Priority levels: high, medium, low
Status options: pending, in_progress, completed, cancelled`
}

function renderTodos(todos: Todo[]): string {
    if (todos.length === 0) return ''

    const lines = todos.map((todo) => {
        const statusIcon =
            todo.status === 'completed'
                ? '[x]'
                : todo.status === 'in_progress'
                  ? '[~]'
                  : todo.status === 'cancelled'
                    ? '[-]'
                    : '[ ]'
        const priorityTag =
            todo.priority === 'high' ? '!' : todo.priority === 'low' ? 'v' : ' '
        return `${statusIcon}(${priorityTag}) ${todo.content}`
    })

    const completedCount = todos.filter(
        (t) => t.status === 'completed' || t.status === 'cancelled'
    ).length

    return `<todos>
${lines.join('\n')}
${completedCount}/${todos.length} tasks completed
</todos>`
}
