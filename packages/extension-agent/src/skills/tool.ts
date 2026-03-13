import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { z } from 'zod'

export interface SkillToolService {
    buildToolDescription(): string
    activateSkill(name: string, conversationId?: string): Promise<string>
}

export class SkillTool extends StructuredTool {
    name = 'skill'
    description: string
    schema: z.ZodObject<{
        name: z.ZodEnum<[string, ...string[]]>
    }>

    constructor(
        private readonly service: SkillToolService,
        names: [string, ...string[]]
    ) {
        super()
        this.description = service.buildToolDescription()
        this.schema = z.object({
            name: z.enum(names).describe('The exact skill name to load')
        })
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _: unknown,
        runConfig?: ChatLunaToolRunnable
    ) {
        return await this.service.activateSkill(
            input.name,
            runConfig?.configurable?.conversationId
        )
    }
}
