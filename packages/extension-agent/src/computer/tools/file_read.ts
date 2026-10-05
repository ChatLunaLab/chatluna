/** @module computer/tools/file_read */

import mimeTypes from 'mime-types'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import z from 'zod'
import { getErrorMessage } from '../../utils/shell'
import { ComputerToolBase } from './base'

export class ReadFileTool extends ComputerToolBase {
    name = 'file_read'

    description = `Read a file or directory from the local filesystem. If the path does not exist, an error is returned.

Usage:
- By default returns up to 2000 lines from the start of the file
- Use offset (1-indexed line number) to read later sections
- Use limit to control how many lines to return
- For directories, lists entries one per line with trailing / for subdirectories
- File content is returned with each line prefixed by its line number as \`<line>: <content>\`
- Images / audio / video / PDF are returned as multimodal content instead, when the current model supports that input type`

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
        const computer = await this.getSession(toolConfig)

        this.log(computer, `读取文件: ${input.filePath}`)

        const mime = mimeTypes.lookup(input.filePath) || ''
        // .ts / .mts / .svg / .m3u 会被 mime-types 当成媒体类型，它们其实是文本
        const capability = /\.(ts|mts|svg|m3u)$/i.test(input.filePath)
            ? null
            : MULTIMODAL_INPUTS[mime.split('/')[0]] || MULTIMODAL_INPUTS[mime]

        if (capability != null) {
            const model = toolConfig?.configurable?.model
            const file = model?.fileHandlingConfig
            const supported =
                model?.modelInfo.capabilities.includes(capability) === true &&
                (file == null || file.supportedMimeTypes.has(mime))

            if (!supported) {
                return `Error: ${input.filePath} (${mime}) cannot be read: the current model lacks ${capability}. Tell the user it is unsupported.`
            }

            const data = await computer.readAsset!(input.filePath)
            if (data.length > (file?.maxFileSizeBytes ?? Infinity)) {
                return `Error: ${input.filePath} is too large for the current model (${data.length} bytes after base64, max ${file?.maxFileSizeBytes}).`
            }

            const key = capability.replace('_input', '_url')
            const url = `data:${mime};base64,${data}`
            return [
                { type: 'text', text: `Read ${mime} file ${input.filePath}` },
                { type: key, [key]: { url, mimeType: mime } }
            ]
        }

        try {
            const result = await computer.readFile(
                input.filePath,
                input.offset,
                input.limit ?? 2000
            )
            this.log(
                computer,
                `完成读取: ${input.filePath} (${result.split('\n').length} 行)`
            )
            return this.withBackend(
                computer,
                await this.formatLargeResult(computer, 'file-read', result)
            )
        } catch (err) {
            if (computer.backend !== 'local') {
                try {
                    const result =
                        await this.computer.readMaterializedSkillFile(
                            computer,
                            input.filePath,
                            input.offset,
                            input.limit ?? 2000
                        )
                    return this.withBackend(
                        computer,
                        await this.formatLargeResult(
                            computer,
                            'file-read',
                            result
                        )
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

/** 多模态文件：MIME 主类型 / 完整 MIME → 需要的模型输入能力（内容块字段由它推导） */
const MULTIMODAL_INPUTS: Record<string, ModelCapabilities> = {
    image: ModelCapabilities.ImageInput,
    audio: ModelCapabilities.AudioInput,
    video: ModelCapabilities.VideoInput,
    'application/pdf': ModelCapabilities.FileInput
}
