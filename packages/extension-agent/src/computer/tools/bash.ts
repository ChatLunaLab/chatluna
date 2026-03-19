/** @module computer/tools/bash */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { formatExecuteResult } from '../backends/types'
import type { ComputerBackgroundJobInfo } from '../../types'
import { getErrorMessage } from '../../utils/shell'
import { ComputerToolBase } from './base'

export class BashTool extends ComputerToolBase {
    name = 'bash'

    description = `Execute a shell command to operate and control the computer.
Automatically uses the correct shell for the current platform (cmd/PowerShell on Windows, sh/bash on Unix).

Rules:
- Working directory defaults to the configured scope path
- Absolute paths outside the scope path are blocked
- Certain high-risk commands require explicit user confirmation
- Commands in the blocked list are always rejected
- If a command may take a while, keep running, or exceed the normal timeout, prefer background=true and query it later yourself

When to use:
- File listing, searching (ls, find, grep, rg, fd)
- Running build tools, tests, scripts
- Renaming, moving, copying files
- Any shell operation not covered by the dedicated file tools
- Long-lived services can be started as managed background jobs and later queried with action=list/status or stopped with action=kill`

    schema = z
        .object({
            command: z
                .string()
                .optional()
                .describe('The shell command to execute.'),
            workdir: z
                .string()
                .optional()
                .describe(
                    'Working directory for the command. Defaults to the scope path. Must be within the scope path when scope is set.'
                ),
            timeout: z
                .number()
                .optional()
                .describe(
                    'Timeout in milliseconds. Foreground commands default to the configured timeout. Background commands only use this when provided.'
                ),
            background: z
                .boolean()
                .optional()
                .describe(
                    'Run the command as a managed background job. Commands ending with & are also treated as background jobs automatically.'
                ),
            action: z
                .enum(['run', 'status', 'list', 'kill'])
                .optional()
                .describe(
                    'run executes a command, status reads one background job, list shows background jobs, kill stops one background job.'
                ),
            jobId: z
                .string()
                .optional()
                .describe('Background job ID used with status or kill.'),
            state: z
                .enum(['running', 'completed', 'failed', 'killed', 'timed_out'])
                .optional()
                .describe(
                    'Optional background job state filter, mainly useful with action list to query only running jobs.'
                )
        })
        .superRefine((input, ctx) => {
            const action = input.action ?? (input.jobId ? 'status' : 'run')
            if (action === 'run' && !input.command?.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['command'],
                    message: 'command is required when action is run.'
                })
            }

            if (
                (action === 'status' || action === 'kill') &&
                !input.jobId?.trim()
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['jobId'],
                    message: 'jobId is required when action is status or kill.'
                })
            }
        })

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const session = toolConfig?.configurable?.session
        const action = input.action ?? (input.jobId ? 'status' : 'run')

        try {
            if (
                action === 'run' &&
                input.command?.trim().startsWith('agentctl')
            ) {
                const cli = this.computer.ctx.chatluna_agent?.cli
                const conversationId = toolConfig?.configurable?.conversationId
                if (
                    !cli ||
                    !conversationId ||
                    !session ||
                    // only admin can use agentctl
                    (await session.getUser().then((user) => user.authority)) < 3
                ) {
                    return this.formatResult(
                        false,
                        'agentctl is unavailable in this tool context'
                    )
                }

                if (input.background) {
                    return this.formatResult(
                        false,
                        'agentctl does not support background execution'
                    )
                }

                return await cli.executeCommand(
                    input.command,
                    conversationId,
                    session
                )
            }

            const computer = await this.getSession(toolConfig)

            if (action === 'list') {
                const jobs = (await this.computer.listBackgroundJobs()).filter(
                    (job) => (input.state ? job.state === input.state : true)
                )
                if (jobs.length < 1) {
                    return input.state
                        ? `No background jobs in state '${input.state}'.`
                        : 'No background jobs.'
                }

                return formatJobList(jobs)
            }

            if (action === 'status') {
                const job = this.computer.getBackgroundJob(input.jobId!)
                if (!job) {
                    return this.formatResult(
                        false,
                        `Background job not found: ${input.jobId}`
                    )
                }

                return await this.formatLargeResult(
                    computer,
                    'bash',
                    formatJobDetail(job)
                )
            }

            if (action === 'kill') {
                const job = await this.computer.killBackgroundJob(input.jobId!)
                if (!job) {
                    return this.formatResult(
                        false,
                        `Background job not found: ${input.jobId}`
                    )
                }

                return await this.formatLargeResult(
                    computer,
                    'bash',
                    `Background job stopped:\n${formatJobDetail(job)}`
                )
            }

            const raw = input.command?.trim()
            const backgroundCommand = raw
                ? stripBackgroundSuffix(raw)
                : undefined
            const background =
                input.background === true || backgroundCommand != null
            const command = backgroundCommand ?? raw ?? ''

            this.log(computer, `执行命令: \`${command}\``)

            if (background) {
                const job = await this.computer.runBackgroundCommand(command, {
                    runConfig: toolConfig,
                    workdir: input.workdir,
                    timeout: input.timeout
                })

                return formatJobStart(job)
            }

            const timeout =
                input.timeout ??
                this.computer.config.computer.local.commandTimeoutMs
            const result = await computer.execute(command, {
                workdir: input.workdir,
                timeout,
                session
            })

            if (result.timedOut) {
                return this.withBackend(
                    computer,
                    `Command timed out after ${timeout}ms.`
                )
            }

            const output = await this.formatLargeResult(
                computer,
                'bash',
                formatExecuteResult(result)
            )

            if (result.signal) {
                return this.withBackend(
                    computer,
                    `Command terminated by signal ${result.signal}:\n${output}`
                )
            }

            if (result.exitCode !== 0) {
                return this.withBackend(
                    computer,
                    `Command exited with code ${result.exitCode}:\n${output}`
                )
            }

            this.log(computer, output)

            return this.withBackend(computer, output)
        } catch (err) {
            return this.formatResult(
                false,
                `Command execution failed: ${getErrorMessage(err)}`
            )
        }
    }
}

function stripBackgroundSuffix(command: string) {
    const trimmed = command.trimEnd()
    if (!trimmed.endsWith('&') || trimmed.endsWith('&&')) {
        return undefined
    }

    return trimmed.slice(0, -1).trimEnd()
}

function formatJobStart(job: ComputerBackgroundJobInfo) {
    return [
        `Background job started: ${job.id}`,
        `State: ${job.state}`,
        `Backend: ${job.backend}`,
        `Terminal: ${job.sessionId}/${job.terminalId}`,
        `Working directory: ${job.cwd}`,
        `Timeout: ${job.timeout == null ? 'none' : `${job.timeout}ms`}`,
        `Command: ${job.command}`,
        `Terminal URL: ${job.url}`,
        `Use bash with {"action":"status","jobId":"${job.id}"} to inspect it or {"action":"list","state":"running"} to query running jobs.`
    ].join('\n')
}

function formatJobList(jobs: ComputerBackgroundJobInfo[]) {
    return jobs
        .map(
            (job) =>
                `${job.id} [${job.state}] ${job.backend} timeout=${job.timeout == null ? 'none' : `${job.timeout}ms`} ${job.command}`
        )
        .join('\n')
}

function formatJobDetail(job: ComputerBackgroundJobInfo) {
    const lines = [
        `Job: ${job.id}`,
        `State: ${job.state}`,
        `Backend: ${job.backend}`,
        `Terminal: ${job.sessionId}/${job.terminalId}`,
        `Working directory: ${job.cwd}`,
        `Started: ${new Date(job.startedAt).toISOString()}`,
        `Timeout: ${job.timeout == null ? 'none' : `${job.timeout}ms`}`,
        `Command: ${job.command}`,
        `Terminal URL: ${job.url}`
    ]

    if (job.endedAt != null) {
        lines.push(`Ended: ${new Date(job.endedAt).toISOString()}`)
    }
    if (job.exitCode != null) {
        lines.push(`Exit code: ${job.exitCode}`)
    }

    lines.push('')
    lines.push('Output:')
    lines.push(job.output || '(no output)')

    return lines.join('\n')
}
