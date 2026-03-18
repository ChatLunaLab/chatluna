/** @module sub-agent/tool */

import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { z } from 'zod'
import { SubAgentTaskService } from '../types'

export class TaskTool extends StructuredTool {
    name = 'task'
    description: string
    schema = z.object({
        agent: z
            .string()
            .describe(
                'The exact sub-agent name from the injected sub-agent catalog'
            ),
        id: z
            .string()
            .optional()
            .describe(
                'Optional existing task id returned by an earlier task call. Reuse it with the same agent to continue that session'
            ),
        prompt: z.string().describe('The task to delegate to the sub-agent'),
        reason: z
            .string()
            .optional()
            .describe('Optional reason for delegating the task')
    })

    constructor(private readonly service: SubAgentTaskService) {
        super()
        this.description = service.buildToolDescription()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _: unknown,
        runConfig?: ChatLunaToolRunnable
    ) {
        return await this.service.runTask(
            {
                agent: input.agent,
                id: input.id,
                prompt: input.prompt,
                reason: input.reason
            },
            runConfig
        )
    }
}
