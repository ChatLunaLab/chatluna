/**
 * @module computer/tools/base
 * @description Computer 工具抽象基类。
 */

import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
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

    /** 格式化工具输出。 */
    protected formatResult(success: boolean, message: string): string {
        return success ? message : `Error: ${message}`
    }
}
