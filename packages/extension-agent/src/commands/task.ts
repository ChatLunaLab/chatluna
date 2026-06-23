/** @module commands/task */

import { Context, Session } from 'koishi'
import type {
    AgentTaskRun,
    AgentTaskSession
} from 'koishi-plugin-chatluna/llm-core/agent'
import { checkAdmin } from 'koishi-plugin-chatluna/utils/koishi'

export function apply(ctx: Context) {
    ctx.command('chatluna.agent.list', 'List sub-agent tasks', {
        authority: 1
    })
        .option('all', '--all')
        .action(async ({ session, options }) => {
            const service = ctx.chatluna_agent
            if (!service) return 'ChatLuna agent service is not ready.'

            if (options.all && !(await checkAdmin(session))) {
                return 'Admin permission is required for --all.'
            }

            const resolved = options.all
                ? undefined
                : await ctx.chatluna.conversation.resolveConversation(session, {
                      permission: 'manage',
                      mode: 'target',
                      allPresetLanes: true,
                      useRoutePresetLane: true
                  })
            const id = resolved?.conversation?.id
            if (!options.all && !id) return 'No active conversation.'

            const runs = service.subAgent.getRuns()
            const tasks = service.subAgent
                .getTasks()
                .filter(
                    (task) => options.all || task.parentConversationId === id
                )
            if (tasks.length < 1) return 'No sub-agent tasks.'

            return [
                'Sub-agent tasks:',
                ...tasks.map((task) => {
                    const run = latest(runs, task.id)
                    return [
                        task.id.slice(0, 8),
                        task.agentName,
                        state(task, run),
                        run?.background ? 'background' : 'foreground',
                        `depth=${task.depth}`,
                        `started=${new Date(task.startedAt).toLocaleString()}`
                    ].join(' | ')
                })
            ].join('\n')
        })

    ctx.command('chatluna.agent.stop [id:string]', 'Stop sub-agent task', {
        authority: 1
    })
        .option('all', '--all')
        .action(async ({ session, options }, id) => {
            const service = ctx.chatluna_agent
            if (!service) return 'ChatLuna agent service is not ready.'

            const resolved = await ctx.chatluna.conversation
                .resolveConversation(session, {
                    permission: 'manage',
                    mode: 'target',
                    allPresetLanes: true,
                    useRoutePresetLane: true
                })
                .catch(() => undefined)
            const conversationId = resolved?.conversation?.id

            if (options.all) {
                if (!conversationId) return 'No active conversation.'
                const count =
                    await service.subAgent.abortByParentConversation(
                        conversationId
                )
                return `已停止 ${count} 个 Sub Agent 任务。`
            }

            if (!conversationId && !id?.trim()) return 'No active conversation.'

            const runs = service.subAgent.getRuns()
            const task = id?.trim()
                ? await findTask(ctx, session, id, conversationId)
                : service.subAgent
                      .getTasks()
                      .filter((task) => {
                          const run = latest(runs, task.id)
                          return (
                              task.parentConversationId === conversationId &&
                              task.activeRunId &&
                              run?.state === 'running'
                          )
                      })
                      .sort((a, b) => b.startedAt - a.startedAt)[0]
            if (typeof task === 'string') return task
            if (!task) return 'No running sub-agent task.'

            const run = latest(runs, task.id)
            if (run?.state !== 'running') return 'Task is not running.'

            const count = await service.subAgent.stopTaskTree(task.id)
            if (count < 1) {
                return 'Task is not running or not stoppable.'
            }

            return id?.trim()
                ? '已停止该 Sub Agent 任务及其子任务。'
                : `已停止 ${count} 个 Sub Agent 任务。`
        })

    ctx.command('chatluna.agent.pause <id:string>', 'Pause sub-agent task', {
        authority: 1
    }).action(async ({ session }, id) => {
        const service = ctx.chatluna_agent
        if (!service) return 'ChatLuna agent service is not ready.'

        const resolved = await ctx.chatluna.conversation.resolveConversation(
            session,
            {
                permission: 'manage',
                mode: 'target',
                allPresetLanes: true,
                useRoutePresetLane: true
            }
        )
        const conversationId = resolved.conversation?.id
        if (!conversationId) return 'No active conversation.'

        const task = await findTask(ctx, session, id, conversationId)
        if (typeof task === 'string') return task

        const run = latest(service.subAgent.getRuns(), task.id)
        if (!run?.background) return 'Only background tasks can be paused.'

        return (await service.subAgent.pauseTask(task.id))
            ? `Pause requested for ${task.id.slice(0, 8)}.`
            : 'Task is not running or already unavailable.'
    })

    ctx.command('chatluna.agent.resume <id:string>', 'Resume sub-agent task', {
        authority: 1
    }).action(async ({ session }, id) => {
        const service = ctx.chatluna_agent
        if (!service) return 'ChatLuna agent service is not ready.'

        const resolved = await ctx.chatluna.conversation.resolveConversation(
            session,
            {
                permission: 'manage',
                mode: 'target',
                allPresetLanes: true,
                useRoutePresetLane: true
            }
        )
        const conversationId = resolved.conversation?.id
        if (!conversationId) return 'No active conversation.'

        const task = await findTask(ctx, session, id, conversationId)
        if (typeof task === 'string') return task

        return (await service.subAgent.resumeTask(task.id))
            ? `Resumed ${task.id.slice(0, 8)}.`
            : 'Task is not paused or already unavailable.'
    })

    ctx.command('chatluna.agent.chat <id:string>', 'Attach to sub-agent task', {
        authority: 1
    }).action(async ({ session }, id) => {
        const service = ctx.chatluna_agent
        if (!service) return 'ChatLuna agent service is not ready.'

        const resolved = await ctx.chatluna.conversation.resolveConversation(
            session,
            {
                permission: 'manage',
                mode: 'target',
                allPresetLanes: true,
                useRoutePresetLane: true
            }
        )
        const conversationId = resolved.conversation?.id
        if (!conversationId) return 'No active conversation.'

        const task = await findTask(ctx, session, id, conversationId)
        if (typeof task === 'string') return task

        const run = latest(service.subAgent.getRuns(), task.id)
        service.subAgent.attachTask(session, task.id, conversationId)
        return [
            `Attached to ${task.agentName} (${task.id.slice(0, 8)}).`,
            `State: ${state(task, run)}. Send messages here; use chatluna.agent.exit to leave.`,
            'Recent history:',
            service.subAgent.getTaskHistory(task)
        ].join('\n')
    })

    ctx.command('chatluna.agent.exit', 'Exit sub-agent attach', {
        authority: 1
    }).action(({ session }) => {
        const service = ctx.chatluna_agent
        if (!service) return 'ChatLuna agent service is not ready.'
        return service.subAgent.detachTaskAttach(session)
            ? 'Exited sub-agent attach mode.'
            : 'No sub-agent attach is active.'
    })
}

async function findTask(
    ctx: Context,
    session: Session,
    id: string | undefined,
    conversationId?: string
) {
    if (!id?.trim()) return 'Task id is required.'

    const service = ctx.chatluna_agent
    const all = await checkAdmin(session)
    if (!all && !conversationId) return 'No active conversation.'
    const tasks = service.subAgent
        .getTasks()
        .filter((task) =>
            all ? true : task.parentConversationId === conversationId
        )
    const matches = tasks.filter((task) => task.id.startsWith(id.trim()))
    if (matches.length < 1) return `Task '${id}' was not found.`
    if (matches.length > 1) {
        return [
            `Task prefix '${id}' is ambiguous:`,
            ...matches.map((task) => `${task.id.slice(0, 8)} ${task.agentName}`)
        ].join('\n')
    }

    return matches[0]
}

function latest(runs: AgentTaskRun[], taskId: string) {
    return runs.find((run) => run.taskId === taskId)
}

function state(task: AgentTaskSession, run?: AgentTaskRun) {
    if (run?.paused) return 'running (paused)'
    return run?.state ?? (task.activeRunId ? 'running' : 'idle')
}

export const inject = ['chatluna_agent']
