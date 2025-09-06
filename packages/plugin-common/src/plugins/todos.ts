/* eslint-disable max-len */
import { StructuredTool } from '@langchain/core/tools'
import { Context, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { z } from 'zod'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'

const todosStore = new Map<
    string,
    {
        id: string
        todos: {
            id: string
            title: string
            description?: string
            status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
            createdAt: Date
            updatedAt: Date
        }[]
        createdAt: Date
    }
>()

function generateId(): string {
    return (
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15)
    )
}

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.todos !== true) {
        return
    }

    plugin.registerTool('todos', {
        selector() {
            return true
        },
        async createTool(params) {
            return new TodosTool()
        }
    })

    // TODO: inject todo status to prompt context
}

export class TodosTool extends StructuredTool {
    name = 'todos'

    schema = z.object({
        action: z
            .enum(['generate', 'set', 'get'])
            .describe('The action to perform'),
        id: z
            .string()
            .optional()
            .describe('The todos ID (required for set and get actions)'),
        todos: z
            .array(
                z.object({
                    title: z.string().describe('The title of the todo'),
                    description: z
                        .string()
                        .optional()
                        .describe('The description of the todo')
                })
            )
            .optional()
            .describe('The todos to generate (required for generate action)'),
        todoId: z
            .string()
            .optional()
            .describe(
                'The specific todo ID to set status (required for set action)'
            ),
        status: z
            .enum(['pending', 'in_progress', 'completed', 'cancelled'])
            .optional()
            .describe('The status to set (required for set action)')

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any

    constructor() {
        super({})
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        config: ChatLunaToolRunnable
    ) {
        const { action, id, todos, todoId, status } = input

        const session = config.metadata.session

        switch (action) {
            case 'generate':
                return await this.generateTodos(todos, session)
            case 'set':
                return await this.setTodoStatus(id, todoId, status, session)
            case 'get':
                return await this.getTodos(id, session)
            default:
                throw new Error(`Unknown action: ${action}`)
        }
    }

    private async generateTodos(
        todosData: { title: string; description?: string }[] | undefined,
        session: Session
    ) {
        if (!todosData || todosData.length === 0) {
            throw new Error('Todos data is required for generate action')
        }

        const todosId = generateId()
        const now = new Date()

        const todos = todosData.map((todo, index) => ({
            id: `${todosId}-${index}`,
            title: todo.title,
            description: todo.description,
            status: 'pending' as const,
            createdAt: now,
            updatedAt: now
        }))

        todosStore.set(todosId, {
            id: todosId,
            todos,
            createdAt: now
        })

        const todosList = todos
            .map(
                (todo) =>
                    `- ${todo.title}${todo.description ? ` (${todo.description})` : ''} [${todo.status}]`
            )
            .join('\n')

        await session.send(
            `任务分解完成！任务ID: ${todosId}\n\n📋 子任务清单：\n${todosList}\n\n💡 现在可以开始执行第一个子任务了。`
        )

        return JSON.stringify({
            id: todosId,
            todos: todos.map((todo) => ({
                id: todo.id,
                title: todo.title,
                description: todo.description,
                status: todo.status
            }))
        })
    }

    private async setTodoStatus(
        todosId: string,
        todoId: string,
        newStatus: string,
        session: Session
    ) {
        if (!todosId || !todoId || !newStatus) {
            throw new Error(
                'Todos ID, todo ID, and status are required for set action'
            )
        }

        const todosData = todosStore.get(todosId)
        if (!todosData) {
            throw new Error(`Todos with ID ${todosId} not found`)
        }

        const todo = todosData.todos.find((t) => t.id === todoId)
        if (!todo) {
            throw new Error(
                `Todo with ID ${todoId} not found in todos ${todosId}`
            )
        }

        const oldStatus = todo.status
        todo.status = newStatus as
            | 'pending'
            | 'in_progress'
            | 'completed'
            | 'cancelled'
        todo.updatedAt = new Date()

        await session.send(
            `🔄 子任务状态更新：\n"${todo.title}" ${oldStatus} → ${newStatus}`
        )

        return JSON.stringify({
            id: todosId,
            todoId,
            oldStatus,
            newStatus,
            title: todo.title
        })
    }

    private async getTodos(todosId: string, session: Session) {
        if (!todosId) {
            throw new Error('Todos ID is required for get action')
        }

        const todosData = todosStore.get(todosId)
        if (!todosData) {
            throw new Error(`Todos with ID ${todosId} not found`)
        }

        const todosList = todosData.todos
            .map(
                (todo) =>
                    `- ${todo.title}${todo.description ? ` (${todo.description})` : ''} [${todo.status}]`
            )
            .join('\n')

        await session.send(`📊 任务执行进度 (ID: ${todosId}):\n\n${todosList}`)

        return JSON.stringify({
            id: todosId,
            todos: todosData.todos.map((todo) => ({
                id: todo.id,
                title: todo.title,
                description: todo.description,
                status: todo.status,
                createdAt: todo.createdAt,
                updatedAt: todo.updatedAt
            })),
            createdAt: todosData.createdAt
        })
    }

    description = `Task breakdown and progress tracking tool for complex workflows. Use this tool to systematically decompose complex tasks into manageable subtasks and track execution progress.

Key capabilities:
- Decompose complex tasks into structured subtasks
- Track progress across multiple work items
- Maintain status updates throughout execution
- Provide clear visibility into task completion

Actions:
• generate: Break down a complex task into subtasks (use first for complex requests)
• set: Update individual subtask status during execution
• get: Check current progress across all subtasks

When to use:
- Complex multi-step tasks requiring organization
- Projects with multiple deliverables or phases
- Tasks where progress tracking adds value
- Work that benefits from systematic decomposition

Workflow:
1. Start with 'generate' action to create subtask structure
2. Use returned task ID for all subsequent operations
3. Update subtask status with 'set' action as work progresses
4. Monitor overall progress with 'get' action

Status options: pending, in_progress, completed, cancelled

Examples:
• Generate: { "action": "generate", "todos": [{"title": "需求分析", "description": "分析用户需求和技术要求"}, {"title": "代码实现"}] }
• Update: { "action": "set", "id": "task_id", "todoId": "subtask_id", "status": "completed" }
• Check: { "action": "get", "id": "task_id" }`
}
