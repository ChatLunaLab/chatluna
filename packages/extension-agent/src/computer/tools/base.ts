/**
 * @module computer/tools/base
 * @description Computer 工具抽象基类。
 */

import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type { ComputerSessionApi } from '../types'
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
        this.computer.ctx.logger.info(
            `[computer:${session.backend}] ${message}`
        )
    }

    protected withBackend(session: ComputerSessionApi, text: string) {
        return `Backend: ${session.backend}\n${text}`
    }

    protected async formatLargeResult(
        session: ComputerSessionApi,
        name: string,
        text: string,
        limit = 8000
    ) {
        return await this.computer.ctx.chatluna_agent.truncateTextOutput({
            name,
            text,
            limit,
            session
        })
    }

    /** 格式化工具输出。 */
    protected formatResult(success: boolean, message: string): string {
        return success ? message : `Error: ${message}`
    }
}
