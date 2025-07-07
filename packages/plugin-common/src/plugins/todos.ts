/* eslint-disable max-len */
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
            `✅ 任务分解完成！任务ID: ${todosId}\n\n📋 子任务清单：\n${todosList}\n\n💡 现在可以开始执行第一个子任务了。`
        )

        return (
            JSON.stringify({
                id: todosId,
                todos: todos.map((todo) => ({
                    id: todo.id,
                    title: todo.title,
                    description: todo.description,
                    status: todo.status
                }))
            }) + `\n\n 任务分解完成！ 现在你需要继续调用工具，执行子任务了。`
        )
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
            `📊 任务执行进度 (ID: ${todosId}):\n\n${todosList}`
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

    description = `CRITICAL: You MUST call this tool BEFORE executing any complex task to break it down into manageable subtasks. This ensures systematic task execution and progress tracking.

IMPORTANT: When faced with any complex request, always start by calling this tool with action "generate" to decompose the task into subtasks. Only proceed with execution after task decomposition.

Actions:
1. generate: Break down a complex task into multiple subtasks (ALWAYS call this first for complex tasks)
2. set: Update the status of a specific subtask during execution
3. get: Check the current progress of all subtasks

Usage:
- generate: { "action": "generate", "todos": [{"title": "Subtask 1", "description": "Details"}, {"title": "Subtask 2"}] }
- set: { "action": "set", "id": "task_id", "todoId": "subtask_id", "status": "completed" }
- get: { "action": "get", "id": "task_id" }

Status values: pending, in_progress, completed, cancelled

Workflow:
1. ALWAYS call generate first for complex tasks
2. Use the returned task ID for all subsequent operations
3. Update subtask status as you complete each step
4. Check progress periodically with get action

Examples:
{ "action": "generate", "todos": [{"title": "需求分析", "description": "分析用户需求和技术要求"}, {"title": "方案设计", "description": "设计技术实现方案"}, {"title": "代码实现", "description": "编写具体代码"}, {"title": "测试验证", "description": "测试功能并验证结果"}] }
{ "action": "set", "id": "abc123", "todoId": "abc123-0", "status": "in_progress" }
{ "action": "get", "id": "abc123" }`
}
