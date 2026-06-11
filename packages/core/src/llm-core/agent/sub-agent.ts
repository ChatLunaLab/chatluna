import {
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage
} from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { randomUUID } from 'crypto'
import type { Awaitable, Session } from 'koishi'
import { z } from 'zod'
import type { ChatLunaToolRunnable } from '../platform/types'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import type { ChatLunaAgent } from './agent'
import { observationToMessageContent } from './legacy-executor'
import { MessageQueue } from './types'
import type { AgentEvent, AgentStep, SubagentContext, ToolMask } from './types'

export interface AgentTaskDescriptor {
    id: string
    name: string
    description: string
}

export interface AgentTaskTarget {
    agent: ChatLunaAgent
    toolMask?: ToolMask
}

export interface AgentTaskSession {
    id: string
    agentId: string
    agentName: string
    conversationId: string
    parentConversationId: string
    depth: number
    maxDepth: number
    parentAgent: string
    activeRunId?: string
    messages: BaseMessage[]
    startedAt: number
    updatedAt: number
}

export interface AgentTaskRunTraceEntry {
    id: string
    type:
        | 'prompt'
        | 'message'
        | 'thought'
        | 'tool-call'
        | 'tool-result'
        | 'output'
        | 'error'
    at: number
    text: string
    tool?: string
    title?: string
    callId?: string
}

export interface AgentTaskRun {
    runId: string
    taskId: string
    agentId: string
    agentName: string
    conversationId: string
    parentConversationId: string
    depth: number
    state: 'running' | 'completed' | 'failed' | 'aborted'
    background?: boolean
    startedAt: number
    endedAt?: number
    lastTool?: string
    toolCount: number
    turnCount: number
    error?: string
    output?: string
    trace: AgentTaskRunTraceEntry[]
}

export interface AgentTaskInput {
    action?: 'run' | 'status' | 'list' | 'message'
    agent?: string
    id?: string
    prompt?: string
    reason?: string
    background?: boolean
    message?: string
}

export interface AgentTaskQueryContext {
    session?: Session
    source?: 'chatluna' | 'character'
}

export interface AgentTaskResolveContext extends AgentTaskQueryContext {
    conversationId?: string
    parent?: SubagentContext
    runConfig?: ChatLunaToolRunnable
}

export interface CreateTaskToolOptions {
    list: (ctx: AgentTaskQueryContext) => Awaitable<AgentTaskDescriptor[]>
    get: (
        name: string,
        ctx: AgentTaskResolveContext
    ) => Awaitable<AgentTaskTarget | undefined>
    refresh?: () => Awaitable<void>
    maxDepth?: number
    taskTtl?: number
    runTtl?: number
    name?: string
}

export interface AgentTaskToolRuntime {
    buildToolDescription(): string
    createTool(): StructuredTool
    dispose(): Promise<void>
    getRuns(): AgentTaskRun[]
    getTasks(): AgentTaskSession[]
    runTask(
        input: AgentTaskInput,
        runConfig?: ChatLunaToolRunnable
    ): Promise<string>
}

interface ActiveAgentTaskRun {
    abort: AbortController
    queue: MessageQueue
}

export function createTaskTool(
    options: CreateTaskToolOptions
): AgentTaskToolRuntime {
    const tasks = new Map<string, AgentTaskSession>()
    const runs = new Map<string, AgentTaskRun>()
    const active = new Map<string, ActiveAgentTaskRun>()
    const runDispose = new Map<string, () => void>()
    const taskDispose = new Map<string, () => void>()
    const toolName = options.name ?? 'task'
    const taskTtl = options.taskTtl ?? 30 * 60 * 1000
    const runTtl = options.runTtl ?? 30 * 60 * 1000

    const runtime: AgentTaskToolRuntime = {
        buildToolDescription() {
            return buildTaskToolDescription()
        },
        createTool() {
            return new AgentTaskTool(toolName, runtime)
        },
        async dispose() {
            for (const item of active.values()) {
                item.abort.abort()
            }

            active.clear()
            clearDisposers(runDispose)
            clearDisposers(taskDispose)
            tasks.clear()
            runs.clear()
        },
        getRuns() {
            return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt)
        },
        getTasks() {
            return [...tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt)
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

            if (action === 'list') {
                if (!conversationId) {
                    return 'Task invocation is missing conversation context.'
                }

                const list = [...tasks.values()]
                    .filter(
                        (item) => item.parentConversationId === conversationId
                    )
                    .sort((a, b) => b.updatedAt - a.updatedAt)

                if (list.length < 1) {
                    return 'No agent tasks in this conversation.'
                }

                return formatTaskList(
                    list,
                    (taskId) => getLatestTaskRun(runs, taskId),
                    toolName
                )
            }

            const id = input.id?.trim()
            const task = id ? tasks.get(id) : undefined
            if (id && !task) {
                return `Task '${input.id}' was not found or expired.`
            }

            if (task && !conversationId) {
                return 'Task invocation is missing conversation context.'
            }

            if (task && task.parentConversationId !== conversationId) {
                return `Task '${task.id}' belongs to a different conversation.`
            }

            if (action === 'status') {
                if (!task) {
                    return 'Task id is required for action=status.'
                }

                touchTaskSession(task)
                scheduleTaskCleanup(task.id)
                return formatTaskDetail(
                    task,
                    getLatestTaskRun(runs, task.id),
                    toolName
                )
            }

            if (action === 'message') {
                if (!task) {
                    return 'Task id is required for action=message.'
                }

                if (!task.activeRunId) {
                    return `Task '${task.id}' is not running. Use action=run with the same id to continue it.`
                }

                const item = active.get(task.activeRunId)
                if (!item) {
                    return `Task '${task.id}' is not accepting live messages because it was not started in background.`
                }

                item.queue.push(new HumanMessage(input.message.trim()))
                touchTaskSession(task)
                scheduleTaskCleanup(task.id)
                await options.refresh?.()

                return [
                    `task_id: ${task.id}`,
                    'state: running',
                    `hint: use ${toolName} action=status id=${task.id}`
                ].join('\n')
            }

            if (parent && parent.depth >= parent.maxDepth) {
                return `Cannot delegate: maximum nesting depth (${parent.maxDepth}) reached.`
            }

            if (!session || !conversationId) {
                return 'Task invocation is missing session context.'
            }

            const agentName = input.agent?.trim() ?? task?.agentName
            if (!agentName) {
                return 'agent is required when starting a new task.'
            }

            const target = await options.get(agentName, {
                session,
                source,
                conversationId,
                parent,
                runConfig
            })

            if (!target) {
                return `Agent '${agentName}' is not available.`
            }

            if (task && target.agent.id !== task.agentId) {
                return `Task '${task.id}' belongs to '${task.agentName}', not '${agentName}'.`
            }

            const next =
                task ??
                createTaskSession(
                    target.agent,
                    conversationId,
                    parent,
                    options.maxDepth
                )
            if (!task) {
                tasks.set(next.id, next)
            }

            if (next.activeRunId) {
                return `Task '${next.id}' is already running. Use action=status to inspect it or action=message to guide it while it runs in background.`
            }

            const raw = input.prompt?.trim()
            if (!raw) {
                return 'Task prompt is empty.'
            }

            const prompt = input.reason?.trim()
                ? `Reason: ${input.reason.trim()}\n\nTask:\n${raw}`
                : raw

            touchTaskSession(next)
            scheduleTaskCleanup(next.id)

            try {
                return await runAgentTask({
                    input,
                    toolName,
                    runtime: options,
                    runs,
                    active,
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
                if (!run) {
                    throw err
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

    function cancelRunCleanup(runId: string) {
        runDispose.get(runId)?.()
        runDispose.delete(runId)
    }

    function cancelTaskCleanup(taskId: string) {
        taskDispose.get(taskId)?.()
        taskDispose.delete(taskId)
    }

    function scheduleRunCleanup(runId: string) {
        cancelRunCleanup(runId)
        runDispose.set(
            runId,
            createTimeout(async () => {
                runDispose.delete(runId)
                runs.delete(runId)
                await options.refresh?.()
            }, runTtl)
        )
    }

    function scheduleTaskCleanup(taskId: string) {
        cancelTaskCleanup(taskId)
        taskDispose.set(
            taskId,
            createTimeout(async () => {
                taskDispose.delete(taskId)
                const task = tasks.get(taskId)
                if (!task) {
                    return
                }

                if (task.activeRunId) {
                    scheduleTaskCleanup(taskId)
                    return
                }

                tasks.delete(taskId)

                for (const run of [...runs.values()]) {
                    if (run.taskId !== taskId) {
                        continue
                    }

                    cancelRunCleanup(run.runId)
                    runs.delete(run.runId)
                }

                await options.refresh?.()
            }, taskTtl)
        )
    }
}

export function buildTaskToolDescription() {
    return [
        'Delegate focused work to a specialist.',
        'Use exact agent names. Use background=true for long tasks.',
        'Use action=list/status to monitor, message to guide, run with id to resume.'
    ].join('\n')
}

export function renderAvailableAgents(
    agents: AgentTaskDescriptor[],
    dir?: string,
    location: 'local' | 'remote' = 'local'
) {
    const lines = [
        '<available_sub_agents>',
        'Delegate to specialists via the task tool. Use background=true for long work.',
        'Monitor with action=status; guide running tasks with action=message.',
        ''
    ]

    if (dir) {
        lines.push(
            `Sub-agents dir (${location}): ${escapeXml(dir)}`,
            'When a task creates or updates a markdown sub-agent, place it under <sub-agents-dir>/<name>/index.md.',
            ''
        )
    }

    for (const item of agents) {
        lines.push(
            '  <sub_agent>',
            `    <name>${escapeXml(item.name)}</name>`,
            `    <description>${escapeXml(item.description)}</description>`,
            '  </sub_agent>'
        )
    }

    lines.push(
        '',
        'Use exact sub-agent names. Include goal, context, and expected result.',
        '</available_sub_agents>'
    )

    return new SystemMessage(lines.join('\n'))
}

class AgentTaskTool extends StructuredTool {
    name: string

    description: string

    schema = z
        .object({
            action: z
                .enum(['run', 'status', 'list', 'message'])
                .optional()
                .describe(
                    'run/resume task, status inspects one, list shows recent, message guides a running background task.'
                ),
            agent: z
                .string()
                .optional()
                .describe(
                    'Exact agent name. Required for new tasks; optional when resuming by id.'
                ),
            id: z
                .string()
                .optional()
                .describe('Existing task id for status, message, or resume.'),
            prompt: z
                .string()
                .optional()
                .describe('Task or follow-up instruction. Required for run.'),
            reason: z
                .string()
                .optional()
                .describe('Optional reason for delegating the task'),
            background: z
                .boolean()
                .optional()
                .describe('Run in background for long work.'),
            message: z
                .string()
                .optional()
                .describe('Guidance for a running background task.')
        })
        .superRefine((input, ctx) => {
            const action = input.action ?? 'run'

            if (action === 'run' && !input.prompt?.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['prompt'],
                    message: 'prompt is required when action is run.'
                })
            }

            if (
                (action === 'status' || action === 'message') &&
                !input.id?.trim()
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['id'],
                    message: 'id is required when action is status or message.'
                })
            }

            if (action === 'message' && !input.message?.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['message'],
                    message: 'message is required when action is message.'
                })
            }
        })

    private _runtime: AgentTaskToolRuntime

    constructor(name: string, runtime: AgentTaskToolRuntime) {
        super()
        this.name = name
        this.description = runtime.buildToolDescription()
        this._runtime = runtime
    }

    async _call(
        input: AgentTaskInput,
        _: unknown,
        runConfig?: ChatLunaToolRunnable
    ) {
        return await this._runtime.runTask(input, runConfig)
    }
}

async function runAgentTask(options: {
    input: AgentTaskInput
    toolName: string
    runtime: CreateTaskToolOptions
    runs: Map<string, AgentTaskRun>
    active: Map<string, ActiveAgentTaskRun>
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
    const toolMask = options.target.toolMask ??
        options.parent?.toolMask ??
        options.runConfig?.configurable?.toolMask ?? {
            mode: 'all' as const,
            allow: [],
            deny: []
        }

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

    const abort = options.input.background ? new AbortController() : undefined
    const queue = options.input.background ? new MessageQueue() : undefined
    const signal = abort?.signal ?? options.signal
    const promptMessage = new HumanMessage(options.prompt)

    options.task.activeRunId = runId
    options.runs.set(runId, run)
    if (abort && queue) {
        options.active.set(runId, { abort, queue })
    }
    options.scheduleTaskCleanup(options.task.id)
    run.trace.push({
        id: `${run.runId}:prompt`,
        type: 'prompt',
        at: Date.now(),
        title: '用户请求',
        text: getMessageContent(promptMessage.content)
    })
    await options.runtime.refresh?.()

    let hasSavedUser = false

    const saveUser = () => {
        if (hasSavedUser) {
            return
        }

        appendTaskMessage(options.task, promptMessage)
        hasSavedUser = true
    }

    const exec = async () => {
        try {
            const result = await options.target.agent.generate({
                prompt: options.prompt,
                session: options.session,
                conversationId: options.task.conversationId,
                requestId: options.input.background
                    ? runId
                    : (options.runConfig?.configurable?.agentContext
                          ?.requestId ?? runId),
                history: [...options.task.messages],
                signal,
                messageQueue: queue,
                toolMask,
                subagentContext: subCtx,
                source: options.source,
                callbacks: options.input.background
                    ? undefined
                    : options.runConfig?.callbacks,
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
            touchTaskSession(options.task)
            options.scheduleRunCleanup(runId)
            options.scheduleTaskCleanup(options.task.id)
            await options.runtime.refresh?.()
            return formatTaskResult(
                options.task,
                run,
                run.output,
                options.toolName
            )
        } catch (err) {
            run.state = signal?.aborted ? 'aborted' : 'failed'
            run.error = err instanceof Error ? err.message : String(err)
            run.trace.push({
                id: `${run.runId}:error`,
                type: 'error',
                at: Date.now(),
                title: run.state === 'aborted' ? '运行已中止' : '运行失败',
                text: run.error
            })
            run.endedAt = Date.now()
            delete options.task.activeRunId
            touchTaskSession(options.task)
            options.scheduleRunCleanup(runId)
            options.scheduleTaskCleanup(options.task.id)
            await options.runtime.refresh?.()
            throw err
        } finally {
            options.active.delete(runId)
        }
    }

    if (options.input.background) {
        exec().catch(() => {})
        return formatTaskStart(options.task, options.toolName)
    }

    return await exec()
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
        appendTaskToolBatch(task, event.steps)
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

function createTaskSession(
    agent: ChatLunaAgent,
    parentConversationId: string,
    parent?: SubagentContext,
    maxDepth = 1
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
        depth,
        maxDepth: limit,
        parentAgent: parent?.agentName ?? 'main',
        messages: [],
        startedAt: now,
        updatedAt: now
    }
}

function touchTaskSession(task: AgentTaskSession) {
    task.updatedAt = Date.now()
}

function appendTaskMessage(task: AgentTaskSession, message: BaseMessage) {
    task.messages.push(message)
    touchTaskSession(task)
}

function appendTaskMessages(task: AgentTaskSession, messages: BaseMessage[]) {
    if (messages.length < 1) {
        return
    }

    task.messages.push(...messages)
    touchTaskSession(task)
}

function appendTaskToolBatch(task: AgentTaskSession, steps: AgentStep[]) {
    if (steps.length < 1) {
        return
    }

    appendTaskMessages(task, createAgentToolMessages(steps))
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

function formatTaskResult(
    task: AgentTaskSession,
    run: AgentTaskRun,
    output: string,
    toolName: string
) {
    return [
        output.trim() || '(empty)',
        '',
        `task_id: ${task.id}`,
        `agent: ${task.agentName}`,
        `state: ${run.state}`,
        `hint: use ${toolName} action=run id=${task.id} to continue`
    ].join('\n')
}

function formatTaskStart(task: AgentTaskSession, toolName: string) {
    return [
        `task_id: ${task.id}`,
        `agent: ${task.agentName}`,
        'state: running',
        'mode: background',
        `hint: ${toolName} action=status id=${task.id}; action=message to guide; action=run to resume`
    ].join('\n')
}

function formatTaskList(
    tasks: AgentTaskSession[],
    getRun: (taskId: string) => AgentTaskRun | undefined,
    toolName: string
) {
    return [
        'Agent tasks:',
        ...tasks.map((task) => {
            const run = getRun(task.id)
            return [
                task.id,
                `[${run?.state ?? (task.activeRunId ? 'running' : 'idle')}]`,
                task.agentName,
                `mode=${run?.background ? 'background' : 'foreground'}`
            ].join(' ')
        }),
        '',
        `Use ${toolName} action=status id=...`
    ].join('\n')
}

function formatTaskDetail(
    task: AgentTaskSession,
    run: AgentTaskRun | undefined,
    toolName: string
) {
    const meta = [
        `task_id: ${task.id}`,
        `agent: ${task.agentName}`,
        `state: ${run?.state ?? (task.activeRunId ? 'running' : 'idle')}`,
        `mode: ${run?.background ? 'background' : 'foreground'}`
    ]

    if (run?.error) {
        meta.push(`error: ${run.error}`)
    }

    if (run?.state === 'running' && run.background) {
        meta.push(`hint: use ${toolName} action=message id=${task.id}`)
    }

    if (run?.state !== 'running') {
        meta.push(`hint: use ${toolName} action=run id=${task.id} to continue`)
    }

    if (run?.output?.trim()) {
        return [run.output.trim(), '', ...meta].join('\n')
    }

    return ['History:', formatTaskHistory(task.messages), '', ...meta].join(
        '\n'
    )
}

function formatTaskHistory(messages: BaseMessage[]) {
    const lines = messages
        .map((message) => {
            const text = getMessageContent(message.content)
                .replace(/\s+/g, ' ')
                .trim()
            if (!text) {
                return undefined
            }

            return `${message.getType()}: ${text.length > 140 ? `${text.slice(0, 137)}...` : text}`
        })
        .filter((item): item is string => item != null)

    if (lines.length < 1) {
        return '(no messages yet)'
    }

    return lines.slice(-3).join('\n')
}

function formatTraceText(value: unknown) {
    if (typeof value === 'string') {
        return value
    }

    if (Array.isArray(value)) {
        const text = value
            .map((item) => {
                if (
                    typeof item === 'object' &&
                    item != null &&
                    'text' in item &&
                    typeof item.text === 'string'
                ) {
                    return item.text
                }

                return JSON.stringify(item, null, 2)
            })
            .join('\n\n')

        if (text) {
            return text
        }
    }

    return JSON.stringify(value, null, 2) ?? String(value)
}

function getLatestTaskRun(runs: Map<string, AgentTaskRun>, taskId: string) {
    return [...runs.values()]
        .filter((item) => item.taskId === taskId)
        .sort((a, b) => b.startedAt - a.startedAt)[0]
}

function clearDisposers(store: Map<string, () => void>) {
    for (const dispose of store.values()) {
        dispose()
    }

    store.clear()
}

function createTimeout(func: () => void | Promise<void>, timeout: number) {
    const timer = setTimeout(() => {
        func()
    }, timeout)

    return () => clearTimeout(timer)
}

function escapeXml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}
