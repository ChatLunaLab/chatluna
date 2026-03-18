/** @module computer/tools/bash */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { formatExecuteResult } from '../backends/types'
import { getErrorMessage } from '../../utils/shell'
import { ComputerToolBase } from './base'

const MSG_EXECUTING = '执行命令'
export class BashTool extends ComputerToolBase {
    name = 'bash'

    description = `Execute a shell command to operate and control the computer. Automatically uses the correct shell for the current platform (cmd/PowerShell on Windows, sh/bash on Unix).

Rules:
- Working directory defaults to the configured scope path
- Absolute paths outside the scope path are blocked
- Certain high-risk commands require explicit user confirmation
- Commands in the blocked list are always rejected
- Output is capped at 8000 characters

When to use:
- File listing, searching (ls, find, grep, rg, fd)
- Running build tools, tests, scripts
- Renaming, moving, copying files
- Any shell operation not covered by the dedicated file tools`

    schema = z.object({
        command: z.string().describe('The shell command to execute.'),
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
                'Timeout in milliseconds. Defaults to the configured timeout.'
            )
    })

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const timeout =
            input.timeout ??
            this.computer.config.computer.local.commandTimeoutMs
        const session = toolConfig?.configurable?.session
        const computer = await this.getSession(toolConfig)

        session?.app.logger.info(`${MSG_EXECUTING}: \`${input.command}\``)

        try {
            const result = await computer.execute(input.command, {
                workdir: input.workdir ?? computer.getScopePath(),
                timeout,
                session
            })

            if (result.timedOut) {
                return `Command timed out after ${timeout}ms.`
            }

            const output = formatExecuteResult(result)

            if (result.signal) {
                return `Command terminated by signal ${result.signal}:\n${output}`
            }

            if (result.exitCode !== 0) {
                return `Command exited with code ${result.exitCode}:\n${output}`
            }

            session?.app.logger.info(output)

            return output
        } catch (err) {
            return this.formatResult(
                false,
                `Command execution failed: ${getErrorMessage(err)}`
            )
        }
    }
}
