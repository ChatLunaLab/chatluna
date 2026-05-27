/** @module computer/tools/publish_file */

import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { getErrorMessage } from '../../utils/shell'
import { ComputerToolBase } from './base'

export class PublishFileTool extends ComputerToolBase {
    name = 'file_publish'

    description = `Publish files generated in the computer environment so Koishi can send them to the user.

Usage:
- Use this after bash creates an artifact like a zip, image, audio file, or report
- Every file must already exist in the current computer backend`

    schema = z.object({
        paths: z
            .array(z.string())
            .min(1)
            .describe('Absolute file paths to publish to the user.')
    })

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const computer = await this.getSession(toolConfig)
        this.log(computer, `发布文件: ${input.paths.join(', ')}`)

        try {
            const files = await this.computer.publishFile(
                input.paths,
                toolConfig
            )
            return this.withBackend(
                computer,
                `Published files:\n${files
                    .map((file) => `- ${file.name}: ${file.url}`)
                    .join('\n')}`
            )
        } catch (err) {
            return this.formatResult(
                false,
                `File publish failed (Check your paths first): ${getErrorMessage(err)}`
            )
        }
    }
}
