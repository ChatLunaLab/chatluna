/* eslint-disable max-len */
import { StructuredTool } from '@langchain/core/tools'
import { Context, Dict, h, Session, Universal } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    fuzzyQuery,
    getMessageContent
} from 'koishi-plugin-chatluna/utils/string'
import { Config } from '..'
import { z } from 'zod'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.cron !== true) {
        return
    }

    // Extend database model
    ctx.model.extend(
        'chatluna_cron_task',
        {
            id: 'unsigned',
            selfId: 'string',
            userId: 'string',
            groupId: 'string',
            guildId: 'string',
            channelId: 'string',
            type: 'string',
            time: 'timestamp',
            lastCall: 'timestamp',
            interval: 'integer',
            content: 'text',
            recipient: 'string',
            command: 'text',
            event: 'json',
            createdAt: 'timestamp',
            executorUserId: 'string'
        },
        {
            autoInc: true
        }
    )

    // Track scheduled tasks
    const scheduledTasks: Dict<(() => void)[]> = {}

    async function hasTask(id: number) {
        const data = await ctx.database.get('chatluna_cron_task', [id])
        return data.length > 0
    }

    async function prepareTask(task: CronTask, session: Session) {
        const now = Date.now()
        const date = task.time.valueOf()

        async function executeTask() {
            ctx.logger.debug('execute task %d: %s', task.id, task.content)
            try {
                if (task.type === 'notification') {
                    await sendNotification(task, session)
                } else if (task.type === 'command' && task.command) {
                    await session.execute(task.command)
                }
            } catch (error) {
                ctx.logger.warn(error)
            }
            if (!task.lastCall || !task.interval) return
            task.lastCall = new Date()
            await ctx.database.set('chatluna_cron_task', task.id, {
                lastCall: task.lastCall
            })
        }

        // Non-repeating task
        if (!task.interval) {
            if (date < now) {
                await ctx.database.remove('chatluna_cron_task', [task.id])
                if (task.lastCall) await executeTask()
                return
            }

            ctx.logger.debug(
                'prepare task %d: %s at %s',
                task.id,
                task.content,
                task.time
            )
            const dispose = ctx.setTimeout(async () => {
                if (!(await hasTask(task.id))) return
                await ctx.database.remove('chatluna_cron_task', [task.id])
                await executeTask()
            }, date - now)

            if (!scheduledTasks[task.id]) scheduledTasks[task.id] = []
            scheduledTasks[task.id].push(dispose)
            return
        }

        // Repeating task
        ctx.logger.debug(
            'prepare task %d: %s from %s every %dms',
            task.id,
            task.content,
            task.time,
            task.interval
        )
        const timeout =
            date < now
                ? task.interval - ((now - date) % task.interval)
                : date - now

        if (task.lastCall && timeout + now - task.interval > +task.lastCall) {
            await executeTask()
        }

        const dispose = ctx.setTimeout(async () => {
            if (!(await hasTask(task.id))) return
            const intervalDispose = ctx.setInterval(async () => {
                if (!(await hasTask(task.id))) {
                    intervalDispose()
                    return
                }
                await executeTask()
            }, task.interval)
            await executeTask()
        }, timeout)

        if (!scheduledTasks[task.id]) scheduledTasks[task.id] = []
        scheduledTasks[task.id].push(dispose)
    }

    async function sendNotification(task: CronTask, session: Session) {
        const message = task.content

        const atElement = h.at(
            task.recipient === 'self' ? session.userId : task.recipient
        )

        await session.send([
            !session.isDirect ? atElement : '',
            h.text(message)
        ])
    }

    // Load existing tasks on ready
    ctx.on('ready', async () => {
        const tasks = await ctx.database.get('chatluna_cron_task', {})
        const tasksByBot: Dict<CronTask[]> = {}

        tasks.forEach((task) => {
            if (!task.event) return
            const bot = ctx.bots[task.selfId]
            if (bot) {
                prepareTask(task, bot.session(task.event))
            } else {
                ;(tasksByBot[task.selfId] ||= []).push(task)
            }
        })

        ctx.on('bot-status-updated', (bot) => {
            if (bot.status !== Universal.Status.ONLINE) return
            const items = tasksByBot[bot.sid]
            if (!items) return
            delete tasksByBot[bot.sid]
            items.forEach((task) => {
                prepareTask(task, bot.session(task.event))
            })
        })
    })

    plugin.registerTool('cron', {
        selector(history) {
            return history.some((message) =>
                fuzzyQuery(getMessageContent(message.content), [
                    '定时',
                    '任务',
                    '醒',
                    '用',
                    'do',
                    '提示',
                    '秒',
                    '分',
                    '时',
                    '天',
                    '星期',
                    'cron',
                    'task',
                    'schedule',
                    'remind',
                    'notification'
                ])
            )
        },

        createTool(params) {
            return new CronTool(ctx, config, scheduledTasks, prepareTask)
        }
    })
}

export class CronTool extends StructuredTool {
    name = 'cron'

    schema = z.object({
        action: z
            .enum(['create', 'get', 'cancel'])
            .describe(
                'The action to perform: create (add new task), get (list tasks), cancel (delete task)'
            ),
        type: z
            .enum(['notification', 'command'])
            .optional()
            .describe(
                'Task type: notification (send reminder) or command (execute command). Required for create action.'
            ),
        time: z
            .string()
            .optional()
            .describe(
                'Time format: Xs/Xm/Xh/Xd (delay), HH:MM (specific time), or "time / interval" for repeating. Required for create action.'
            ),
        content: z
            .string()
            .optional()
            .describe(
                'The message content for notification or command to execute. Required for create action.'
            ),
        recipient: z
            .string()
            .optional()
            .describe(
                'For notification: "self" (default), "group", or user ID'
            ),
        executorUserId: z
            .string()
            .optional()
            .describe(
                'User ID who executes the command. For command type: actual user ID for user-requested, empty defaults to current user. Note: "0" will be converted to current user.'
            ),
        taskId: z.number().optional().describe('Task ID for cancel action')
    })

    constructor(
        private ctx: Context,
        private config: Config,
        private scheduledTasks: Dict<(() => void)[]>,
        private prepareTask: (task: CronTask, session: Session) => Promise<void>
    ) {
        super({})
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        config: ChatLunaToolRunnable
    ) {
        const session = config.configurable.session
        const {
            action,
            type,
            time,
            content,
            recipient,
            executorUserId,
            taskId
        } = input

        switch (action) {
            case 'get':
                return await this.listTasks(session)
            case 'cancel':
                return await this.cancelTask(taskId, session)
            case 'create':
                return await this.createTask(
                    session,
                    type,
                    time,
                    content,
                    recipient,
                    executorUserId
                )
            default:
                return `Unknown action: ${action}`
        }
    }

    private async listTasks(session: Session) {
        const tasks = await this.ctx.database.get('chatluna_cron_task', {
            selfId: session.selfId,
            userId: session.userId
        })

        if (tasks.length === 0) {
            await session.send('No scheduled tasks found.')
            return 'No tasks found'
        }

        const taskList = tasks
            .map((task, idx) => {
                const timeStr = formatTime(task.time, task.interval)
                const typeStr =
                    task.type === 'notification' ? 'Reminder' : 'Command'
                return `${task.id}. ${typeStr} - ${timeStr}: ${task.content}`
            })
            .join('\n')

        await session.send(`Your scheduled tasks:\n${taskList}`)
        return JSON.stringify(
            tasks.map((t) => ({
                id: t.id,
                type: t.type,
                time: t.time,
                content: t.content
            }))
        )
    }

    private async cancelTask(taskId: number | undefined, session: Session) {
        if (!taskId) {
            return 'Task ID is required for cancel action'
        }

        const task = await this.ctx.database.get('chatluna_cron_task', [taskId])
        if (!task.length || task[0].userId !== session.userId) {
            await session.send(
                `Task ${taskId} not found or you don't have permission to cancel it.`
            )
            return `Task ${taskId} not found`
        }

        // Cancel scheduled execution
        if (this.scheduledTasks[taskId]) {
            this.scheduledTasks[taskId].forEach((dispose) => dispose())
            delete this.scheduledTasks[taskId]
        }

        await this.ctx.database.remove('chatluna_cron_task', [taskId])
        await session.send(`Task ${taskId} has been cancelled.`)
        return `Task ${taskId} cancelled successfully`
    }

    private async createTask(
        session: Session,
        type: 'notification' | 'command' | undefined,
        time: string | undefined,
        content: string | undefined,
        recipient: string | undefined,
        executorUserId: string | undefined
    ) {
        if (!type || !time || !content) {
            return 'Type, time, and content are required for create action'
        }

        // Permission check for command type
        let finalExecutorUserId = executorUserId || session.userId
        // If executorUserId is "0", set it to current user
        if (finalExecutorUserId === '0') {
            finalExecutorUserId = session.userId
        }

        if (type === 'command') {
            // Check if user has command execution permission
            const hasPermission =
                this.config.cronScopeSelector?.includes(finalExecutorUserId)
            if (!hasPermission) {
                await session.send(
                    `Error: User ${finalExecutorUserId} does not have permission to create command tasks.`
                )
                return `Permission denied for user ${finalExecutorUserId}`
            }
        }

        const parsedTime = parseTimeString(time)
        if (!parsedTime) {
            await session.send(
                `Invalid time format: ${time}. Use formats like: 10s, 5m, 2h, 1d, 14:30, or "10m / 1h" for repeating tasks.`
            )
            return `Invalid time format: ${time}`
        }

        const task = await this.ctx.database.create('chatluna_cron_task', {
            selfId: session.selfId,
            userId: session.userId,
            groupId: session.event.guild?.id,
            guildId: session.guildId,
            channelId: session.channelId,
            type,
            time: parsedTime.time,
            interval: parsedTime.interval,
            content,
            recipient: recipient || 'self',
            command: type === 'command' ? content : undefined,
            event: session.event,
            createdAt: new Date(),
            executorUserId: finalExecutorUserId
        })

        await this.prepareTask(task, session)

        const timeStr = formatTime(parsedTime.time, parsedTime.interval)
        const typeLabel = type === 'notification' ? 'Reminder' : 'Command'
        await session.send(
            `Task #${task.id} created (${typeLabel})\nContent: ${content}\nScheduled for: ${timeStr}`
        )

        return JSON.stringify({
            id: task.id,
            type,
            time: parsedTime.time,
            interval: parsedTime.interval,
            content
        })
    }

    description = `Manages scheduled tasks for notifications and command execution. Supports one-time and recurring tasks with flexible time formats.

Actions:
• create: Create a new scheduled task
• get: List all your scheduled tasks
• cancel: Delete a scheduled task by ID

Task Types:
• notification: Send reminder messages to users/groups
• command: Execute bot commands (requires executor permission)

Time Formats:
• Delay: 10s, 5m, 2h, 1d (seconds/minutes/hours/days from now)
• Specific time: 14:30 (today at 2:30 PM, or tomorrow if time passed)
• Repeating: "10m / 1h" (start after 10 minutes, repeat every 1 hour)

Recipient (for notifications):
• "self" or empty: Send to task creator (default)
• "group": Send to entire group
• User ID: Send to specific user

Executor Permission (for commands):
• User ID: User-requested execution (must have permission)
• Empty: Defaults to current user
• Note: "0" will be automatically converted to current user

Examples:
• Create reminder: { "action": "create", "type": "notification", "time": "10m", "content": "Time for a break!", "recipient": "self" }
• Create recurring task: { "action": "create", "type": "notification", "time": "14:30 / 1d", "content": "Daily standup", "recipient": "group" }
• List tasks: { "action": "get" }
• Cancel task: { "action": "cancel", "taskId": 5 }
• Execute command: { "action": "create", "type": "command", "time": "1h", "content": "plugin.upgrade" }`
}

declare module 'koishi' {
    interface Tables {
        chatluna_cron_task: CronTask
    }
}

export interface CronTask {
    id: number
    selfId: string
    userId: string
    groupId?: string
    guildId?: string
    channelId?: string
    type: 'notification' | 'command'
    time: Date
    lastCall?: Date
    interval?: number
    content: string
    recipient?: string
    command?: string
    event: Universal.Event
    createdAt: Date
    executorUserId?: string
}

// Time parsing utilities
function parseTimeString(
    timeStr: string
): { time: Date; interval?: number } | null {
    const now = new Date()

    // Check for interval format: "time / interval"
    if (timeStr.includes('/')) {
        const [timePart, intervalPart] = timeStr.split('/').map((s) => s.trim())
        const baseTime = parseTimeString(timePart)
        if (!baseTime) return null

        const interval = parseInterval(intervalPart)
        if (!interval) return null

        return { time: baseTime.time, interval }
    }

    // Parse specific time formats
    // HH:MM format (today at that time)
    if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
        const [hours, minutes] = timeStr.split(':').map(Number)
        const time = new Date(now)
        time.setHours(hours, minutes, 0, 0)
        if (time < now) {
            time.setDate(time.getDate() + 1) // Next day
        }
        return { time }
    }

    // Relative time: Xs, Xm, Xh, Xd
    const interval = parseInterval(timeStr)
    if (interval) {
        const time = new Date(now.getTime() + interval)
        return { time }
    }

    return null
}

function parseInterval(intervalStr: string): number | null {
    const match = intervalStr.match(/^(\d+)(s|m|h|d)$/)
    if (!match) return null

    const value = parseInt(match[1])
    const unit = match[2]

    switch (unit) {
        case 's':
            return value * 1000
        case 'm':
            return value * 60 * 1000
        case 'h':
            return value * 60 * 60 * 1000
        case 'd':
            return value * 24 * 60 * 60 * 1000
        default:
            return null
    }
}

function formatTime(date: Date, interval?: number): string {
    if (!interval) {
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    const hours = Math.floor(interval / (60 * 60 * 1000))
    const minutes = Math.floor((interval % (60 * 60 * 1000)) / (60 * 1000))
    const seconds = Math.floor((interval % (60 * 1000)) / 1000)

    const parts = []
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0) parts.push(`${minutes}m`)
    if (seconds > 0) parts.push(`${seconds}s`)

    return `every ${parts.join(' ')}`
}
