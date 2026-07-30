/**
 * @module computer/tools/base
 * @description Computer 工具抽象基类。
 */

import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { logger } from '../..'
import type { ComputerSessionApi, TextOutput } from '../types'
import type { ChatLunaAgentComputerService } from '../../service/computer'

/** Computer 工具抽象基类。 */
export abstract class ComputerToolBase extends StructuredTool {
    constructor(protected readonly computer: ChatLunaAgentComputerService) {
        super()
    }

    /** 获取当前 tool 对应的 computer session。 */
    protected getSession(runConfig?: ChatLunaToolRunnable) {
        return this.computer.getToolSession(runConfig)
    }

    protected log(session: ComputerSessionApi, message: string) {
        logger.info(`[computer:${session.backend}] ${message}`)
    }

    protected withBackend(session: ComputerSessionApi, text: string) {
        return `Backend: ${session.backend}\n${text}`
    }

    protected async formatLargeResult(
        session: ComputerSessionApi,
        name: string,
        text: string | TextOutput,
        limit = 8000
    ) {
        return await this.computer.ctx.chatluna_agent.truncateTextOutput({
            name,
            text: typeof text === 'string' ? text : text.text,
            outputPath: typeof text === 'string' ? undefined : text.outputPath,
            totalLength:
                typeof text === 'string' ? undefined : text.totalLength,
            limit,
            session
        })
    }

    /** 格式化工具输出。 */
    protected formatResult(success: boolean, message: string): string {
        return success ? message : `Error: ${message}`
    }
}
