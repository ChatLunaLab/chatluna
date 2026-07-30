/** @module computer/tools/glob */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { getErrorMessage } from '../../utils/shell'
import { ComputerToolBase } from './base'

export class GlobTool extends ComputerToolBase {
    name = 'glob'

    description = `Fast file pattern matching tool that works with any codebase size.
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths in search traversal order`

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
            `查找文件: ${input.pattern}${input.path ? ` in ${input.path}` : ''}`
        )

        try {
            const results = await computer.glob(input.pattern, input.path)
            const count = Array.isArray(results)
                ? results.length
                : (results.count ?? 0)
            if (count < 1) {
                return 'No files matched.'
            }

            this.log(computer, `找到 ${count} 个文件`)
            return this.withBackend(
                computer,
                await this.formatLargeResult(
                    computer,
                    'glob',
                    Array.isArray(results) ? results.join('\n') : results
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
