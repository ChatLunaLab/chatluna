/** @module computer/tools/grep */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { getErrorMessage } from '../../utils/shell'
import { ComputerToolBase } from './base'

export class GrepTool extends ComputerToolBase {
    name = 'grep'

    description = `Fast content search tool that works with any codebase size.
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
- Filter files by glob pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers in search traversal order`

    schema = z.object({
        pattern: z
            .string()
            .describe('The regex pattern to search for in file contents.'),
        path: z
            .string()
            .optional()
            .describe(
                'The directory to search in. Defaults to the scope path.'
            ),
        include: z
            .string()
            .optional()
            .describe(
                'File glob pattern to include in the search (e.g. "*.js", "*.{ts,tsx}").'
            )
    })

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const computer = await this.getSession(toolConfig)

        this.log(
            computer,
            `搜索: ${input.pattern}${input.include ? ` (${input.include})` : ''}${input.path ? ` in ${input.path}` : ''}`
        )

        try {
            const results = await computer.grep(
                input.pattern,
                input.path,
                input.include
            )
            const count = Array.isArray(results)
                ? results.length
                : results.count
            if (count < 1) {
                return 'No matches found.'
            }

            this.log(computer, `找到 ${count} 条匹配`)
            return this.withBackend(
                computer,
                await this.formatLargeResult(computer, 'grep', results)
            )
        } catch (err) {
            return this.formatResult(
                false,
                `Grep failed: ${getErrorMessage(err)}`
            )
        }
    }
}
