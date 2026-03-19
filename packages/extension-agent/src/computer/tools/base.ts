/**
 * @module computer/tools/base
 * @description Computer 工具抽象基类。
 */

import { randomUUID } from 'node:crypto'
import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { truncateOutput } from '../backends/types'
import type { ComputerSessionApi } from '../types'
import { getErrorMessage } from '../../utils/shell'
import type { ChatLunaAgentComputerService } from '../../service/computer'

/** Computer 工具抽象基类。 */
export abstract class ComputerToolBase extends StructuredTool {
    constructor(protected readonly computer: ChatLunaAgentComputerService) {
        super()
    }

    /** 获取当前 tool 对应的 computer session。 */
    protected async getSession(runConfig?: ChatLunaToolRunnable) {
        return await this.computer.getToolSession(runConfig)
    }

    protected async formatLargeResult(
        session: ComputerSessionApi,
        name: string,
        text: string,
        limit = 8000
    ) {
        if (text.length <= limit) {
            return text
        }

        const base = session.getScopePath() || session.cwd || process.cwd()
        const root = /^[A-Za-z]:[\\/]?$/.test(base)
            ? `${base[0]}:/`
            : base === '/'
              ? '/'
              : base.replace(/[\\/]+$/, '')
        const sep = root.endsWith('/') ? '' : '/'
        const filePath = `${root}${sep}.tmp-chatluna-${name}-${Date.now()}-${randomUUID()}.txt`

        try {
            await session.writeFile(filePath, text)
            return `Output too large (${text.length} chars). Truncated preview below.
Full output saved to: ${filePath}
Use file_read with this path plus offset/limit to inspect more.

${truncateOutput(text, limit)}`
        } catch (err) {
            this.computer.ctx.logger.warn(err)
            return `Output too large (${text.length} chars). Truncated preview below.
Failed to save full output: ${getErrorMessage(err)}

${truncateOutput(text, limit)}`
        }
    }

    /** 格式化工具输出。 */
    protected formatResult(success: boolean, message: string): string {
        return success ? message : `Error: ${message}`
    }
}
