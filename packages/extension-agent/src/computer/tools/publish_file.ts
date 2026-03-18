/** @module computer/tools/publish_file */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { getErrorMessage } from '../../utils/shell'
import { ComputerToolBase } from './base'

const MSG_PUBLISHING = '发布文件'

export class PublishFileTool extends ComputerToolBase {
    name = 'file_publish'

    description = `Publish a file generated in the computer environment so Koishi can send it to the user.

Usage:
- Use this after bash creates an artifact like a zip, image, audio file, or report
- The file must already exist in the current computer backend`

    schema = z.object({
        path: z.string().describe('Absolute file path to publish to the user.')
    })

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        this.computer.ctx.logger.info(`${MSG_PUBLISHING}: ${input.path}`)

        try {
            const file = await this.computer.publishFile(input.path, toolConfig)
            return `Published file: ${file.url}`
        } catch (err) {
            return this.formatResult(
                false,
                `File publish failed (Check your path first): ${getErrorMessage(err)}`
            )
        }
    }
}
