/** @module computer/tools/file_edit */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { getErrorMessage } from '../../utils/shell'
import { ComputerToolBase } from './base'

const MSG_EDITING = '编辑文件'
const MSG_DONE = '完成编辑'

export class EditFileTool extends ComputerToolBase {
    name = 'file_edit'

    description = `Performs exact string replacement in a file.

Usage:
- The edit will FAIL if oldString is not found in the file.
- The edit will FAIL if oldString is found multiple times - provide more surrounding context to make it unique, or use replaceAll to change every instance.
- Use replaceAll for renaming variables or strings across the whole file.
- Returns context showing 10 lines before and after each change.`

    schema = z.object({
        filePath: z
            .string()
            .describe('The absolute path to the file to modify.'),
        oldString: z.string().describe('The text to replace.'),
        newString: z
            .string()
            .describe(
                'The text to replace it with (must be different from oldString).'
            ),
        replaceAll: z
            .boolean()
            .optional()
            .describe('Replace all occurrences of oldString (default false).')
    })

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const session = toolConfig?.configurable?.session
        const computer = await this.getSession(toolConfig)

        await session?.send(`${MSG_EDITING}: ${input.filePath}`)

        try {
            const result = await computer.editFile(
                input.filePath,
                input.oldString,
                input.newString,
                input.replaceAll ? undefined : 1
            )

            if (!result.success) {
                return `oldString not found in ${input.filePath}`
            }

            await session?.send(
                `${MSG_DONE}: ${input.filePath} (替换 ${result.replacements} 处)`
            )
            return `Replaced ${result.replacements} occurrence(s) in ${input.filePath}\n\nContext (> marks modified lines):\n${result.context}`
        } catch (err) {
            return this.formatResult(
                false,
                `File edit failed: ${getErrorMessage(err)}`
            )
        }
    }
}
