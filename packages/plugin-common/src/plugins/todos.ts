import { StructuredTool } from '@langchain/core/tools'
import { Context, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { z } from 'zod'

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
        alwaysRecreate: true,

        async createTool(params, session) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return new TodosTool(session) as any
        }
    })
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

    constructor(public session: Session) {
        super({})
    }

    /** @ignore */
    async _call(input: z.infer<typeof this.schema>) {
        const { action, id, todos, todoId, status } = input

        switch (action) {
            case 'generate':
                return await this.generateTodos(todos)
            case 'set':
                return await this.setTodoStatus(id, todoId, status)
            case 'get':
                return await this.getTodos(id)
            default:
                throw new Error(`Unknown action: ${action}`)
        }
    }

    private async generateTodos(
        todosData: { title: string; description?: string }[] | undefined
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

        await this.session.send(
            `任务分解完成，任务ID: ${todosId}\n\n${todosList}`
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
        newStatus: string
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

        await this.session.send(
            `任务 "${todo.title}" 状态已更新: ${oldStatus} → ${newStatus}`
        )

        return JSON.stringify({
            id: todosId,
            todoId,
            oldStatus,
            newStatus,
            title: todo.title
        })
    }

    private async getTodos(todosId: string) {
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

        await this.session.send(
            `当前任务进度 (ID: ${todosId}):\n\n${todosList}`
        )

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

    description = `Task decomposition and progress tracking tool for complex task execution.

Actions:
1. generate: Break down a complex task into multiple subtasks
2. set: Update the status of a specific subtask
3. get: Check the current progress of all subtasks

Usage:
- generate: { "action": "generate", "todos": [{"title": "Subtask 1", "description": "Details"}, {"title": "Subtask 2"}] }
- set: { "action": "set", "id": "task_id", "todoId": "subtask_id", "status": "completed" }
- get: { "action": "get", "id": "task_id" }

Status values: pending, in_progress, completed, cancelled

Examples:
{ "action": "generate", "todos": [{"title": "数据收集", "description": "收集用户需求信息"}, {"title": "方案设计", "description": "设计技术方案"}] }
{ "action": "set", "id": "abc123", "todoId": "abc123-0", "status": "in_progress" }
{ "action": "get", "id": "abc123" }`
}
