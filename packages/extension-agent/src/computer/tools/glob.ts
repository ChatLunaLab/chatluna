/** @module computer/tools/glob */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { getErrorMessage } from '../../utils/shell'
import { ComputerToolBase } from './base'

const MSG_FINDING = '查找文件'
const MSG_FOUND = '找到'

export class GlobTool extends ComputerToolBase {
    name = 'glob'

    description = `Fast file pattern matching tool that works with any codebase size.
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time`

    schema = z.object({
        pattern: z
            .string()
            .describe('The glob pattern to match files against.'),
        path: z
            .string()
            .optional()
            .describe('The directory to search in. Defaults to the scope path.')
    })

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const computer = await this.getSession(toolConfig)

        this.log(
            computer,
            `${MSG_FINDING}: ${input.pattern}${input.path ? ` in ${input.path}` : ''}`
        )

        try {
            const results = await computer.glob(input.pattern, input.path)
            if (results.length < 1) {
                return 'No files matched.'
            }

            this.log(computer, `${MSG_FOUND} ${results.length} 个文件`)
            return this.withBackend(
                computer,
                await this.formatLargeResult(
                    computer,
                    'glob',
                    results.join('\n')
                )
            )
        } catch (err) {
            return this.formatResult(
                false,
                `Glob failed: ${getErrorMessage(err)}`
            )
        }
    }
}
