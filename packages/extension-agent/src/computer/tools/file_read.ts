/** @module computer/tools/file_read */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { getErrorMessage } from '../../utils/shell'
import { ComputerToolBase } from './base'

const MSG_READING = '读取文件'
const MSG_DONE = '完成读取'

export class ReadFileTool extends ComputerToolBase {
    name = 'file_read'

    description = `Read a file or directory from the local filesystem. If the path does not exist, an error is returned.

Usage:
- By default returns up to 2000 lines from the start of the file
- Use offset (1-indexed line number) to read later sections
- Use limit to control how many lines to return
- For directories, lists entries one per line with trailing / for subdirectories
- File content is returned with each line prefixed by its line number as \`<line>: <content>\``

    schema = z.object({
        filePath: z
            .string()
            .describe('The absolute path to the file or directory to read.'),
        offset: z
            .number()
            .optional()
            .describe('The line number to start reading from (1-indexed).'),
        limit: z
            .number()
            .optional()
            .describe('The maximum number of lines to read (defaults to 2000).')
    })

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const session = toolConfig?.configurable?.session
        const computer = await this.getSession(toolConfig)

        session.app.logger.info(`${MSG_READING}: ${input.filePath}`)

        try {
            const result = await computer.readFile(
                input.filePath,
                input.offset,
                input.limit ?? 2000
            )
            session.app.logger.info(
                `${MSG_DONE}: ${input.filePath} (${result.split('\n').length} 行)`
            )
            return result
        } catch (err) {
            if (computer.backend !== 'local') {
                try {
                    return await this.computer.readMaterializedSkillFile(
                        computer,
                        input.filePath,
                        input.offset,
                        input.limit ?? 2000
                    )
                } catch {}
            }

            return this.formatResult(
                false,
                `File read failed: ${getErrorMessage(err)}`
            )
        }
    }
}
