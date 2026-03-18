/** @module computer/tools/grep */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { getErrorMessage } from '../../utils/shell'
import { ComputerToolBase } from './base'

const MSG_SEARCHING = '搜索'
const MSG_FOUND = '找到'

export class GrepTool extends ComputerToolBase {
    name = 'grep'

    description = `Fast content search tool that works with any codebase size.
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
- Filter files by glob pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with at least one match, sorted by modification time`

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
        const session = toolConfig?.configurable?.session
        const computer = await this.getSession(toolConfig)

        session.app.logger.info(
            `${MSG_SEARCHING}: ${input.pattern}${input.include ? ` (${input.include})` : ''}${input.path ? ` in ${input.path}` : ''}`
        )

        try {
            const results = await computer.grep(
                input.pattern,
                input.path,
                input.include
            )
            if (results.length < 1) {
                return 'No matches found.'
            }

            session.app.logger.info(`${MSG_FOUND} ${results.length} 条匹配`)
            return results.join('\n')
        } catch (err) {
            return this.formatResult(
                false,
                `Grep failed: ${getErrorMessage(err)}`
            )
        }
    }
}
