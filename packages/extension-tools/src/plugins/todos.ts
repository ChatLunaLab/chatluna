/* eslint-disable max-len */
import { StructuredTool } from '@langchain/core/tools'
import { Context, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { z } from 'zod'
import { Document } from '@langchain/core/documents'
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
        createTool(params) {
            return new TodosTool()
        }
    })

    ctx.on(
        'chatluna/before-chat',
        async (conversationId, message, promptVariables, chatInterface) => {
            const todos = todosStore.get(conversationId)

            if (!todos) {
                return
            }

            const documents: Document[][] = promptVariables['documents'] ?? []

            const completedCount = todos.todos.filter(
                (t) => t.status === 'completed' || t.status === 'cancelled'
            ).length
            const totalCount = todos.todos.length

            documents.push([
                new Document({
                    pageContent: `TASK PROGRESS TRACKING:
You have an active task breakdown with ${totalCount} subtasks (${completedCount}/${totalCount} completed).

Current status:
${todos.todos
    .map((todo, idx) => {
        const status =
            todo.status === 'completed'
                ? '[✓]'
                : todo.status === 'in_progress'
                  ? '[→]'
                  : '[ ]'
        return `${idx + 1}. ${status} ${todo.title}${todo.description ? ` - ${todo.description}` : ''}`
    })
    .join('\n')}

IMPORTANT INSTRUCTIONS:
1. You MUST update task status as you make progress on each subtask
2. Use the 'set' or 'batch_set' action to mark tasks as completed when done
3. Tasks must be completed in sequential order (1→2→3...)
4. When user requests change the task scope or add new requirements, regenerate the task breakdown with 'generate' action
5. Always keep the task list up-to-date to reflect your actual progress
6. When marking a task as completed, send the update immediately - don't wait

Remember: The task tracker is a contract with the user. Keep it current!`
                })
            ])

            promptVariables['documents'] = documents
        }
    )
}

export class TodosTool extends StructuredTool {
    name = 'todos'

    schema = z.object({
        action: z
            .enum(['generate', 'set', 'get', 'batch_set'])
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
            .describe('The status to set (required for set action)'),
        updates: z
            .array(
                z.object({
                    todoId: z.string().describe('The todo ID to update'),
                    status: z
                        .enum([
                            'pending',
                            'in_progress',
                            'completed',
                            'cancelled'
                        ])
                        .describe('The status to set')
                })
            )
            .optional()
            .describe('Batch updates (required for batch_set action)')

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
        const { action, id, todos, todoId, status, updates } = input

        const session = config.configurable.session
        const conversationId = config.configurable.conversationId

        switch (action) {
            case 'generate':
                return await this.generateTodos(conversationId, todos, session)
            case 'set':
                return await this.setTodoStatus(
                    conversationId || id,
                    todoId,
                    status,
                    session
                )
            case 'batch_set':
                return await this.batchSetTodoStatus(
                    conversationId || id,
                    updates,
                    session
                )
            case 'get':
                return await this.getTodos(conversationId || id, session)
            default:
                throw new Error(`Unknown action: ${action}`)
        }
    }

    private async generateTodos(
        conversationId: string,
        todosData: { title: string; description?: string }[] | undefined,
        session: Session
    ) {
        if (!todosData || todosData.length === 0) {
            return 'Todos data is required for generate action'
        }

        if (todosData.length < 3) {
            return 'Task is too simple. At least 3 subtasks are required to use the todos tool. For simpler tasks, proceed directly without using this tool.'
        }

        const todosId = conversationId || generateId()
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
            .map((todo, index) => `- [ ] ${todo.title}`)
            .join('\n')

        await session.send(`任务分解完成！\n\n${todosList}\n`)

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
            return 'Todos ID, todo ID, and status are required for set action'
        }

        const todosData = todosStore.get(todosId)
        if (!todosData) {
            return `Todos with ID ${todosId} not found`
        }

        const todoIndex = todosData.todos.findIndex((t) => t.id === todoId)
        if (todoIndex === -1) {
            return `Todo with ID ${todoId} not found in todos ${todosId}`
        }

        const todo = todosData.todos[todoIndex]

        // Validate sequential update: only allow updating if all previous todos are completed or cancelled
        if (newStatus === 'in_progress' || newStatus === 'completed') {
            for (let i = 0; i < todoIndex; i++) {
                const prevTodo = todosData.todos[i]
                if (
                    prevTodo.status !== 'completed' &&
                    prevTodo.status !== 'cancelled'
                ) {
                    return `Cannot update todo "${todo.title}" (index ${todoIndex + 1}). Previous todo "${prevTodo.title}" (index ${i + 1}) must be completed or cancelled first. Please update todos in sequential order (1, 2, 3...).`
                }
            }
        }

        const oldStatus = todo.status
        todo.status = newStatus as
            | 'pending'
            | 'in_progress'
            | 'completed'
            | 'cancelled'
        todo.updatedAt = new Date()

        const marker =
            todo.status === 'completed'
                ? '[x]'
                : todo.status === 'in_progress'
                  ? '[→]'
                  : todo.status === 'cancelled'
                    ? '[-]'
                    : '[ ]'
        await session.send(`- ${marker} ${todo.title}`)

        // Check if all todos are completed
        const allCompleted = todosData.todos.every(
            (t) => t.status === 'completed' || t.status === 'cancelled'
        )

        if (allCompleted) {
            await session.send(`所有子任务已完成！`)
            todosStore.delete(todosId)
        }

        return JSON.stringify({
            id: todosId,
            todoId,
            oldStatus,
            newStatus,
            title: todo.title,
            allCompleted
        })
    }

    private async batchSetTodoStatus(
        todosId: string,
        updates: { todoId: string; status: string }[] | undefined,
        session: Session
    ) {
        if (!todosId || !updates || updates.length === 0) {
            return 'Todos ID and updates are required for batch_set action'
        }

        const todosData = todosStore.get(todosId)
        if (!todosData) {
            return `Todos with ID ${todosId} not found`
        }

        // Validate all updates first
        const updateInfos = updates.map((update) => {
            const todoIndex = todosData.todos.findIndex(
                (t) => t.id === update.todoId
            )
            if (todoIndex === -1) {
                return {
                    ...update,
                    index: -1,
                    error: `Todo with ID ${update.todoId} not found in todos ${todosId}`
                }
            }
            return { ...update, index: todoIndex, error: undefined }
        })

        if (updateInfos.some((info) => info.error != null)) {
            return updateInfos
                .filter((info) => info.error != null)
                .map((info) => info.error)
                .join('\n')
        }

        // Sort by index to ensure sequential updates

        updateInfos.sort((a, b) => a.index - b.index)

        // Validate sequential constraint
        for (const updateInfo of updateInfos) {
            const { index, status } = updateInfo
            if (status === 'in_progress' || status === 'completed') {
                for (let i = 0; i < index; i++) {
                    const prevTodo = todosData.todos[i]
                    if (
                        prevTodo.status !== 'completed' &&
                        prevTodo.status !== 'cancelled'
                    ) {
                        return `Cannot update todo at index ${index + 1}. Previous todo "${prevTodo.title}" (index ${i + 1}) must be completed or cancelled first. Please update todos in sequential order (1, 2, 3...).`
                    }
                }
            }
        }

        // Apply all updates
        const results: string[] = []
        for (const updateInfo of updateInfos) {
            const todo = todosData.todos[updateInfo.index]

            todo.status = updateInfo.status as
                | 'pending'
                | 'in_progress'
                | 'completed'
                | 'cancelled'
            todo.updatedAt = new Date()

            const checkbox = updateInfo.status === 'completed' ? '[x]' : '[ ]'
            results.push(`- ${checkbox} ${todo.title}`)
        }

        // Send update message
        await session.send(results.join('\n'))

        // Check if all todos are completed
        const allCompleted = todosData.todos.every(
            (t) => t.status === 'completed' || t.status === 'cancelled'
        )

        if (allCompleted) {
            await session.send(`所有子任务已完成！`)
            todosStore.delete(todosId)
        }

        return JSON.stringify({
            id: todosId,
            updates: updateInfos.map((u) => ({
                todoId: u.todoId,
                status: u.status
            })),
            allCompleted
        })
    }

    private async getTodos(todosId: string, session: Session) {
        if (!todosId) {
            return 'Todos ID is required for get action'
        }

        const todosData = todosStore.get(todosId)
        if (!todosData) {
            return `Todos with ID ${todosId} not found`
        }

        const todosList = todosData.todos
            .map((todo) => {
                const checkbox = todo.status === 'completed' ? '[x]' : '[ ]'
                return `- ${checkbox} ${todo.title}${todo.description ? ` - ${todo.description}` : ''}`
            })
            .join('\n')

        await session.send(todosList)

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
• Generate: { "action": "generate", "todos": [{"title": "需求分析1", "description": "分析用户需求和技术要求"}, {"title": "需求分析2"}, {"title": "需求分析3"}, {"title": "最终检查"}] }
• Update: { "action": "set", "id": "task_id", "todoId": "subtask_id", "status": "completed" }
• Check: { "action": "get", "id": "task_id" }`
}
