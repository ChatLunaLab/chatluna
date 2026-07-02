import { randomUUID } from 'crypto'
import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage
} from '@langchain/core/messages'
import type { Session } from 'koishi'
import { logger } from 'koishi-plugin-chatluna'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { observationToMessageContent } from '../legacy-executor'
import { MessageQueue } from '../types'
import type { AgentEvent, AgentStep, SubagentContext, ToolMask } from '../types'
import type { ChatLunaToolRunnable } from '../../platform/types'
import type { ChatLunaAgent } from '../agent'
import type {
    ActiveAgentTaskRun,
    AgentTaskInput,
    AgentTaskRun,
    AgentTaskSession,
    AgentTaskSessionSnapshot,
    AgentTaskTarget,
    CreateTaskToolOptions
} from './types'
import {
    formatAgentTaskWakeup,
    formatTaskResult,
    formatTaskStart,
    formatTraceText
} from './utils'

export async function runAgentTask(options: {
    input: AgentTaskInput
    toolName: string
    runtime: CreateTaskToolOptions
    tasks: Map<string, AgentTaskSession>
    runs: Map<string, AgentTaskRun>
    active: Map<string, ActiveAgentTaskRun>
    snapshots: Map<string, AgentTaskSessionSnapshot>
    scheduleRunCleanup: (runId: string) => void
    scheduleTaskCleanup: (taskId: string) => void
    task: AgentTaskSession
    target: AgentTaskTarget
    prompt: string
    session: Session
    conversationId: string
    source: 'chatluna' | 'character'
    parent?: SubagentContext
    signal?: AbortSignal
    runConfig?: ChatLunaToolRunnable
}) {
    const runId = randomUUID()
    const toolMask: ToolMask = options.target.toolMask ??
        options.parent?.toolMask ??
        (options.runConfig?.configurable as { toolMask?: ToolMask })
            ?.toolMask ?? { mode: 'all' as const, allow: [], deny: [] }

    const subCtx: SubagentContext = {
        agentId: options.target.agent.id,
        agentName: options.target.agent.name,
        parentConversationId: options.task.parentConversationId,
        depth: options.task.depth,
        maxDepth: options.task.maxDepth,
        toolMask,
        disableHandoff: options.task.depth >= options.task.maxDepth,
        traceInfo: {
            runId,
            parentAgent: options.task.parentAgent,
            startedAt: Date.now()
        }
    }

    const run: AgentTaskRun = {
        runId,
        taskId: options.task.id,
        agentId: options.target.agent.id,
        agentName: options.target.agent.name,
        conversationId: options.task.conversationId,
        parentConversationId: options.task.parentConversationId,
        depth: options.task.depth,
        state: 'running',
        background: options.input.background,
        startedAt: Date.now(),
        toolCount: 0,
        turnCount: 0,
        trace: []
    }

    const isBg = options.input.background
    const abort = new AbortController()
    const queue = isBg ? new MessageQueue() : undefined
    const activeRun: ActiveAgentTaskRun = { abort, queue }
    const signal = abort.signal
    const promptMessage = new HumanMessage(options.prompt)
    const snapshot: AgentTaskSessionSnapshot | undefined = isBg
        ? {
              session: options.session,
              routing: createTaskRouting(options.session)
          }
        : undefined

    options.task.activeRunId = runId
    options.runs.set(runId, run)
    if (snapshot) options.snapshots.set(runId, snapshot)
    options.active.set(runId, activeRun)
    options.scheduleTaskCleanup(options.task.id)

    run.trace.push({
        id: `${runId}:prompt`,
        type: 'prompt',
        at: Date.now(),
        title: '用户请求',
        text: getMessageContent(promptMessage.content)
    })

    let hasSavedUser = false
    const saveUser = () => {
        if (hasSavedUser) return
        appendTaskMessage(options.task, promptMessage)
        hasSavedUser = true
    }

    const exec = async () => {
        const abortByParent = () => abort.abort(options.signal?.reason)
        if (!isBg && options.signal) {
            if (options.signal.aborted) abortByParent()
            options.signal.addEventListener('abort', abortByParent, {
                once: true
            })
        }

        try {
            await options.runtime.refresh?.()

            const result = await options.target.agent.generate({
                prompt: options.prompt,
                session: options.session,
                conversationId: options.task.conversationId,
                requestId: isBg
                    ? runId
                    : (options.runConfig?.configurable?.agentContext
                          ?.requestId ?? runId),
                history: [...options.task.messages],
                signal,
                messageQueue: queue,
                pauseGate: async (sig) => {
                    while (activeRun.paused) {
                        if (sig?.aborted) return
                        await new Promise<void>((resolve) => {
                            const done = () => {
                                sig?.removeEventListener('abort', done)
                                activeRun.resume = undefined
                                resolve()
                            }
                            activeRun.resume = done
                            sig?.addEventListener('abort', done, {
                                once: true
                            })
                        })
                    }
                },
                toolMask,
                subagentContext: subCtx,
                source: options.source,
                callbacks: isBg ? undefined : options.runConfig?.callbacks,
                onStep: async (event) => {
                    await onTaskEvent(options.task, run, saveUser, event)
                    await options.runtime.refresh?.()
                }
            })

            run.state = 'completed'
            run.output = String(result.output ?? '')
            run.endedAt = Date.now()

            if (getMessageContent(result.message.content).trim().length > 0) {
                saveUser()
                appendTaskMessage(options.task, result.message)
            }

            delete options.task.activeRunId
            options.task.updatedAt = Date.now()
            options.scheduleRunCleanup(runId)
            options.scheduleTaskCleanup(options.task.id)
            await notifyFinished(options, run, snapshot)
            await options.runtime.refresh?.()
            return formatTaskResult(
                options.task,
                run,
                run.output,
                options.toolName
            )
        } catch (err) {
            run.state = signal?.aborted ? 'aborted' : 'failed'
            run.error = signal?.aborted
                ? '用户已停止任务。'
                : err instanceof Error
                  ? err.message
                  : String(err)
            run.trace.push({
                id: `${runId}:error`,
                type: 'error',
                at: Date.now(),
                title: run.state === 'aborted' ? '运行已中止' : '运行失败',
                text: run.error
            })
            run.endedAt = Date.now()
            delete options.task.activeRunId
            options.task.updatedAt = Date.now()
            options.scheduleRunCleanup(runId)
            options.scheduleTaskCleanup(options.task.id)
            await notifyFinished(options, run, snapshot)
            await options.runtime.refresh?.()
            throw err
        } finally {
            if (!isBg) {
                options.signal?.removeEventListener('abort', abortByParent)
            }
            options.active.delete(runId)
        }
    }

    if (isBg) {
        exec().catch((err) => {
            if (run.state === 'aborted' || signal.aborted) return
            logger.error('[SubagentBgTaskError]', err)
        })
        return formatTaskStart(options.task, options.toolName)
    }

    return exec()
}

async function notifyFinished(
    options: {
        input: AgentTaskInput
        runtime: CreateTaskToolOptions
        tasks: Map<string, AgentTaskSession>
        active: Map<string, ActiveAgentTaskRun>
        task: AgentTaskSession
        target: AgentTaskTarget
        source: 'chatluna' | 'character'
    },
    run: AgentTaskRun,
    snapshot?: AgentTaskSessionSnapshot
) {
    if (!options.input.background || run.state === 'aborted') return

    let parentId = options.task.parentConversationId
    const message = new HumanMessage(
        formatAgentTaskWakeup(options.task.id, options.task.agentName, run)
    )

    while (parentId.startsWith('subagent:')) {
        const task = options.tasks.get(parentId.slice('subagent:'.length))
        const item = task?.activeRunId
            ? options.active.get(task.activeRunId)
            : undefined
        if (item) {
            item.queue.push(message)
            return
        }
        if (!task) return
        parentId = task.parentConversationId
    }

    try {
        await options.runtime.onRunFinished?.({
            run,
            taskId: options.task.id,
            agentId: options.target.agent.id,
            agentName: options.target.agent.name,
            parentConversationId: parentId,
            source: options.source,
            snapshot
        })
    } catch (err) {
        logger.error(
            `[SubagentOnRunFinishedError] run=${run.runId} task=${options.task.id} agent=${options.target.agent.name}`,
            err
        )
    }
}

async function onTaskEvent(
    task: AgentTaskSession,
    run: AgentTaskRun,
    saveUser: () => void,
    event: AgentEvent
) {
    if (event.type === 'tool-call') {
        const thought = event.actions[0]?.log?.trim()
        if (thought) {
            run.trace.push({
                id: `${run.runId}:thought:${run.trace.length}`,
                type: 'thought',
                at: Date.now(),
                title: '模型输出',
                text: thought
            })
        }
        run.toolCount += event.actions.length
        run.lastTool = event.actions[event.actions.length - 1]?.tool
        for (const action of event.actions) {
            run.trace.push({
                id: `${run.runId}:tool-call:${action.toolCallId ?? run.trace.length}`,
                type: 'tool-call',
                at: Date.now(),
                title: `调用工具：${action.tool}`,
                tool: action.tool,
                callId: action.toolCallId,
                text:
                    typeof action.toolInput === 'string'
                        ? action.toolInput
                        : JSON.stringify(action.toolInput, null, 2)
            })
        }
    }

    if (event.type === 'tool-result') {
        saveUser()
        if (event.steps.length > 0) {
            appendTaskMessages(task, createAgentToolMessages(event.steps))
        }
        for (const step of event.steps) {
            run.trace.push({
                id: `${run.runId}:tool-result:${step.action.toolCallId ?? run.trace.length}`,
                type: 'tool-result',
                at: Date.now(),
                title: `工具输出：${step.action.tool}`,
                tool: step.action.tool,
                callId: step.action.toolCallId,
                text: formatTraceText(step.observation)
            })
        }
    }

    if (event.type === 'human-update') {
        saveUser()
        appendTaskMessages(task, event.messages)
        for (const item of event.messages) {
            run.trace.push({
                id: `${run.runId}:message:${run.trace.length}`,
                type: 'message',
                at: Date.now(),
                title: '追加消息',
                text: getMessageContent(item.content)
            })
        }
    }

    if (event.type === 'round-decision') {
        run.turnCount += 1
    }

    if (event.type === 'done') {
        run.trace.push({
            id: `${run.runId}:output`,
            type: 'output',
            at: Date.now(),
            title: '最终输出',
            text:
                (event.replyEmitted ? '最终回复已由工具发送。' : '') ||
                getMessageContent(event.message?.content ?? '') ||
                event.output ||
                event.log
        })
    }
}

export function createTaskSession(
    agent: ChatLunaAgent,
    parentConversationId: string,
    session: Session,
    parent?: SubagentContext,
    maxDepth = 1,
    promptContent?: string
): AgentTaskSession {
    const id = randomUUID()
    const depth = (parent?.depth ?? 0) + 1
    const limit = parent?.maxDepth ?? maxDepth
    if (parent && depth > limit) {
        throw new Error(`Maximum sub-agent depth ${limit} reached`)
    }
    const now = Date.now()
    return {
        id,
        agentId: agent.id,
        agentName: agent.name,
        conversationId: `subagent:${id}`,
        parentConversationId,
        routing: createTaskRouting(session),
        depth,
        maxDepth: limit,
        parentAgent: parent?.agentName ?? 'main',
        promptContent,
        messages: [],
        startedAt: now,
        updatedAt: now
    }
}

function createTaskRouting(session: Session) {
    return {
        platform: session.platform,
        selfId: session.selfId,
        userId: session.userId,
        username: session.username ?? undefined,
        guildId: session.guildId ?? undefined,
        channelId: session.channelId ?? undefined,
        isDirect: session.isDirect ?? false
    }
}

function appendTaskMessage(task: AgentTaskSession, message: BaseMessage) {
    task.messages.push(message)
    task.updatedAt = Date.now()
}

function appendTaskMessages(task: AgentTaskSession, messages: BaseMessage[]) {
    if (messages.length < 1) return
    task.messages.push(...messages)
    task.updatedAt = Date.now()
}

function createAgentToolMessages(steps: AgentStep[]): BaseMessage[] {
    const reasoning = steps[0]?.action.reasoningContent
    const message = steps[0]?.action.messageLog?.[0]
    return [
        new AIMessage({
            content: '',
            additional_kwargs: {
                ...(message?.additional_kwargs ?? {}),
                ...(reasoning != null ? { reasoning_content: reasoning } : {})
            },
            tool_calls: steps.map((step) => ({
                id: step.action.toolCallId,
                name: step.action.tool,
                args:
                    typeof step.action.toolInput !== 'string'
                        ? step.action.toolInput
                        : { input: step.action.toolInput }
            }))
        }),
        ...steps.map(
            (step) =>
                new ToolMessage({
                    content: observationToMessageContent(step.observation),
                    tool_call_id: step.action.toolCallId,
                    name: step.action.tool
                })
        )
    ]
}
