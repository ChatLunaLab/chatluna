import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { z } from 'zod'

export interface SubAgentTaskService {
    buildToolDescription(): string
    runTask(
        input: {
            agent: string
            prompt: string
            reason?: string
        },
        runConfig?: ChatLunaToolRunnable
    ): Promise<string>
}

export class TaskTool extends StructuredTool {
    name = 'task'
    description: string
    schema = z.object({
        agent: z
            .string()
            .describe(
                'The exact sub-agent name from the injected sub-agent catalog'
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
                prompt: input.prompt,
                reason: input.reason
            },
            runConfig
        )
    }
}
