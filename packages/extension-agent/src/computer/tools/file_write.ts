/** @module computer/tools/file_write */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { getErrorMessage } from '../../utils/shell'
import { formatFileDiff } from '../file_changes'
import { ComputerToolBase } from './base'

export class WriteFileTool extends ComputerToolBase {
    name = 'file_write'

    description = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.
- Creates the file and parent directories if they don't exist.`

    schema = z.object({
        filePath: z
            .string()
            .describe(
                'The absolute path to the file to write (must be absolute, not relative).'
            ),
        content: z.string().describe('The content to write to the file.')
    })

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const computer = await this.getSession(toolConfig)

        this.log(computer, `写入文件: ${input.filePath}`)

        try {
            const result = await computer.writeFile(
                input.filePath,
                input.content
            )
            this.log(computer, `完成写入: ${input.filePath}`)
            return this.withBackend(
                computer,
                result.type === 'text'
                    ? result.before === result.after
                        ? `No changes. ${input.filePath} already has the requested content.`
                        : `Diff:\n${formatFileDiff(result.before, result.after)}\n\nWrote ${input.filePath}`
                    : `Wrote ${input.filePath}`
            )
        } catch (err) {
            return this.formatResult(
                false,
                `${input.filePath}: ${getErrorMessage(err)}`
            )
        }
    }
}
