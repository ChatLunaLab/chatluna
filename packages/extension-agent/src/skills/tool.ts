import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { z } from 'zod'

export interface SkillToolService {
    buildToolDescription(): string
    activateSkill(
        name: string,
        runConfig?: ChatLunaToolRunnable
    ): Promise<string>
}

export class SkillTool extends StructuredTool {
    name = 'skill'
    description: string
    schema = z.object({
        name: z
            .string()
            .describe('The exact skill name from the injected skills catalog')
    })

    constructor(private readonly service: SkillToolService) {
        super()
        this.description = service.buildToolDescription()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _: unknown,
        runConfig?: ChatLunaToolRunnable
    ) {
        return await this.service.activateSkill(input.name, runConfig)
    }
}
