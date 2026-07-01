import { logger } from 'koishi-plugin-chatluna'
import { HumanMessage } from '@langchain/core/messages'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { createTaskSession, runAgentTask } from './executor'
import { AgentTaskTool, buildTaskToolDescription } from './tool'
import {
    formatTaskDetail,
    formatTaskList,
    formatTaskResult,
    getLatestTaskRun
} from './utils'
import type {
    ActiveAgentTaskRun,
    AgentTaskRun,
    AgentTaskSession,
    AgentTaskSessionSnapshot,
    AgentTaskToolRuntime,
    CreateTaskToolOptions
} from './types'

export function createTaskTool(
    options: CreateTaskToolOptions
): AgentTaskToolRuntime {
    const tasks = new Map<string, AgentTaskSession>()
    const runs = new Map<string, AgentTaskRun>()
    const active = new Map<string, ActiveAgentTaskRun>()
    const snapshots = new Map<string, AgentTaskSessionSnapshot>()
    const runDispose = new Map<string, () => void>()
    const taskDispose = new Map<string, () => void>()
    const toolName = options.name ?? 'task'
    const taskTtl = options.taskTtl ?? 30 * 60 * 1000
    const runTtl = options.runTtl ?? 30 * 60 * 1000

    const refreshQuietly = async () => {
        try {
            await options.refresh?.()
        } catch (err) {
            logger.error(err)
        }
    }

    const scheduleRunCleanup = (runId: string) => {
        runDispose.get(runId)?.()
        runDispose.delete(runId)
        const timer = setTimeout(async () => {
            runDispose.delete(runId)
            runs.delete(runId)
            snapshots.delete(runId)
            await refreshQuietly()
        }, runTtl)
        runDispose.set(runId, () => clearTimeout(timer))
    }

    const scheduleTaskCleanup = (taskId: string) => {
        taskDispose.get(taskId)?.()
        taskDispose.delete(taskId)
        const timer = setTimeout(async () => {
            taskDispose.delete(taskId)
            const task = tasks.get(taskId)
            if (!task) return
            if (task.activeRunId) {
                scheduleTaskCleanup(taskId)
                return
            }
            tasks.delete(taskId)
            for (const run of [...runs.values()]) {
                if (run.taskId !== taskId) continue
                runDispose.get(run.runId)?.()
                runDispose.delete(run.runId)
                runs.delete(run.runId)
                snapshots.delete(run.runId)
            }
            await refreshQuietly()
        }, taskTtl)
        taskDispose.set(taskId, () => clearTimeout(timer))
    }

    const stopTaskRun = (runId: string) => {
        const item = active.get(runId)
        if (!item) return false
        const run = runs.get(runId)
        if (run) run.paused = false
        item.paused = false
        item.resume?.()
        item.abort.abort(
            new ChatLunaError(ChatLunaErrorCode.ABORTED, undefined, true)
        )
        return true
    }

    const runtime: AgentTaskToolRuntime = {
        buildToolDescription() {
            return buildTaskToolDescription()
        },
        createTool() {
            return new AgentTaskTool(toolName, runtime)
        },
        async dispose() {
            for (const item of active.values()) item.abort.abort()
            active.clear()
            for (const d of runDispose.values()) d()
            for (const d of taskDispose.values()) d()
            runDispose.clear()
            taskDispose.clear()
            tasks.clear()
            runs.clear()
            snapshots.clear()
        },
        getRuns() {
            return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt)
        },
        getTasks() {
            return [...tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt)
        },
        getTask(id) {
            return tasks.get(id)
        },
        async stopTask(id) {
            const runId = tasks.get(id)?.activeRunId
            if (!runId || !stopTaskRun(runId)) return false
            await refreshQuietly()
            return true
        },
        async pauseTask(id) {
            const runId = tasks.get(id)?.activeRunId
            const item = runId ? active.get(runId) : undefined
            if (!runId || !item || item.paused) return false
            item.paused = true
            const run = runs.get(runId)
            if (run) run.paused = true
            await refreshQuietly()
            return true
        },
        async resumeTask(id) {
            const runId = tasks.get(id)?.activeRunId
            const item = runId ? active.get(runId) : undefined
            if (!runId || !item?.paused) return false
            item.paused = false
            const run = runs.get(runId)
            if (run) run.paused = false
            item.resume?.()
            await refreshQuietly()
            return true
        },
        async abortByParentConversation(id) {
            let count = 0
            for (const task of tasks.values()) {
                if (
                    task.parentConversationId === id &&
                    task.activeRunId &&
                    stopTaskRun(task.activeRunId)
                ) {
                    count += 1
                }
            }
            if (count > 0) await refreshQuietly()
            return count
        },
        async chatTask(id, prompt, ctx) {
            const task = tasks.get(id)
            if (!task)
                return {
                    state: 'failed' as const,
                    output: `Task '${id}' was not found or expired.`
                }

            const runId = task.activeRunId
            const item = runId ? active.get(runId) : undefined
            if (runId && item?.queue) {
                item.queue.push(new HumanMessage(prompt))
                task.updatedAt = Date.now()
                scheduleTaskCleanup(task.id)
                await refreshQuietly()
                return { state: 'queued' as const }
            }

            if (runId) {
                return {
                    state: 'failed' as const,
                    output: `Task '${task.id}' is not accepting live messages because it was not started in background.`
                }
            }

            const output = await runtime.runTask(
                { action: 'run', id, prompt },
                ctx.runConfig
            )
            const run = getLatestTaskRun(runs, id)
            return { state: run?.state ?? 'completed', output }
        },
        async runTask(input, runConfig) {
            const action = input.action ?? 'run'
            const parent =
                runConfig?.configurable?.agentContext?.subagentContext
            const session = runConfig?.configurable?.session
            const conversationId = runConfig?.configurable?.conversationId
            const source =
                (
                    runConfig?.configurable as {
                        source?: 'chatluna' | 'character'
                    }
                )?.source ?? 'chatluna'

            if (action === 'list' || action === 'list_all') {
                if (!conversationId && action === 'list')
                    return 'Task invocation is missing conversation context.'
                const list = [...tasks.values()]
                    .filter(
                        (t) =>
                            action === 'list_all' ||
                            t.parentConversationId === conversationId
                    )
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                if (list.length < 1)
                    return action === 'list_all'
                        ? 'No agent tasks found.'
                        : 'No agent tasks in this conversation.'
                return formatTaskList(
                    list,
                    (tid) => getLatestTaskRun(runs, tid),
                    toolName,
                    action === 'list_all'
                )
            }

            const id = input.id?.trim()
            const task = id ? tasks.get(id) : undefined
            if (id && !task)
                return `Task '${input.id}' was not found or expired.`
            if (task && !conversationId)
                return 'Task invocation is missing conversation context.'
            if (task && task.parentConversationId !== conversationId)
                return `Task '${task.id}' belongs to a different conversation.`

            if (action === 'stop') {
                if (!task) return 'Task id is required for action=stop.'
                const runId = task.activeRunId
                if (!runId || !stopTaskRun(runId))
                    return `Task '${task.id}' is not running or not stoppable.`
                task.updatedAt = Date.now()
                scheduleTaskCleanup(task.id)
                await refreshQuietly()
                return [
                    `task_id: ${task.id}`,
                    `agent: ${task.agentName}`,
                    'state: stop requested',
                    'hint: the running sub-agent model request is being aborted.'
                ].join('\n')
            }

            if (action === 'status') {
                if (!task) return 'Task id is required for action=status.'
                task.updatedAt = Date.now()
                scheduleTaskCleanup(task.id)
                return formatTaskDetail(
                    task,
                    getLatestTaskRun(runs, task.id),
                    toolName
                )
            }

            if (action === 'message') {
                if (!task) return 'Task id is required for action=message.'
                if (!task.activeRunId)
                    return `Task '${task.id}' is not running. Use action=run with the same id to continue it.`
                const item = active.get(task.activeRunId)
                if (!item?.queue)
                    return `Task '${task.id}' is not accepting live messages because it was not started in background.`
                item.queue.push(new HumanMessage(input.message.trim()))
                task.updatedAt = Date.now()
                scheduleTaskCleanup(task.id)
                await refreshQuietly()
                return [
                    `task_id: ${task.id}`,
                    'state: running',
                    'hint: guidance delivered; result will arrive automatically. Do not poll status.'
                ].join('\n')
            }

            if (parent && parent.depth >= parent.maxDepth) {
                return `Cannot delegate: maximum nesting depth (${parent.maxDepth}) reached.`
            }

            if (!session || !conversationId)
                return 'Task invocation is missing session context.'

            const raw = input.prompt?.trim() ?? ''
            const name = input.agent?.trim()
            const agentName = name ?? task?.agentName
            const ctx = {
                session,
                source,
                conversationId,
                parent,
                runConfig
            }
            let promptContent: string | undefined
            const target =
                task?.promptContent && !name
                    ? await options.create?.({
                          ...ctx,
                          id: task.agentId,
                          name: task.agentName,
                          prompt: task.promptContent
                      })
                    : agentName
                      ? await options.get(agentName, ctx)
                      : options.create && raw
                        ? await options.create({ ...ctx, prompt: raw })
                        : undefined

            if (!target) {
                if (agentName && !task?.promptContent) {
                    return `Agent '${agentName}' is not available.`
                }
                if (task?.promptContent) {
                    return `Task '${task.id}' prompt-only sub-agent is not available.`
                }
                if (!options.create) {
                    return 'agent is required when starting a new task.'
                }
                return 'Task prompt is empty.'
            }

            if (!task && !name) {
                promptContent = raw
            }
            if (task && target.agent.id !== task.agentId)
                return `Task '${task.id}' belongs to '${task.agentName}', not '${target.agent.name}'.`

            const next =
                task ??
                createTaskSession(
                    target.agent,
                    conversationId,
                    session,
                    parent,
                    options.maxDepth,
                    promptContent
                )
            if (!task) tasks.set(next.id, next)
            if (next.activeRunId)
                return `Task '${next.id}' is already running; result will arrive automatically. Use action=message to guide it.`

            const parts: string[] = []
            if (input.goal?.trim()) parts.push(`Goal:\n${input.goal.trim()}`)
            if (raw) parts.push(`Task:\n${raw}`)

            const content = parts.join('\n\n')
            if (!content.trim()) return 'Task prompt is empty.'
            const prompt = input.reason?.trim()
                ? `Reason: ${input.reason.trim()}\n\n${content}`
                : content

            next.updatedAt = Date.now()
            scheduleTaskCleanup(next.id)

            try {
                return await runAgentTask({
                    input,
                    toolName,
                    runtime: options,
                    tasks,
                    runs,
                    active,
                    snapshots,
                    scheduleRunCleanup,
                    scheduleTaskCleanup,
                    task: next,
                    target,
                    prompt,
                    session,
                    conversationId,
                    source,
                    parent,
                    signal: runConfig?.signal,
                    runConfig
                })
            } catch (err) {
                const run = getLatestTaskRun(runs, next.id)
                if (!run) throw err
                if (run.state === 'aborted') {
                    return [
                        'The user manually stopped this sub-agent task. Do not continue it.',
                        'If needed, ask the user to clarify the task requirements.',
                        '',
                        `task_id: ${next.id}`,
                        `agent: ${next.agentName}`,
                        `state: ${run.state}`
                    ].join('\n')
                }
                return formatTaskResult(
                    next,
                    run,
                    err instanceof Error ? err.message : String(err),
                    toolName
                )
            }
        }
    }

    return runtime
}
