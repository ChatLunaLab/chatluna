/** @module computer/tools/file_write */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { getErrorMessage } from '../../utils/shell'
import { ComputerToolBase } from './base'

const MSG_WRITING = '写入文件'
const MSG_DONE = '完成写入'

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
        const session = toolConfig?.configurable?.session
        const computer = await this.getSession(toolConfig)

        await session?.send(`${MSG_WRITING}: ${input.filePath}`)

        try {
            await computer.writeFile(input.filePath, input.content)
            await session?.send(`${MSG_DONE}: ${input.filePath}`)
            return this.formatResult(true, `Wrote ${input.filePath}`)
        } catch (err) {
            return this.formatResult(
                false,
                `${input.filePath}: ${getErrorMessage(err)}`
            )
        }
    }
}
