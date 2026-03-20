/** @module cli/tool */

import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { z } from 'zod'
import { getErrorMessage } from '../utils/shell'
import type { ChatLunaAgentCliService } from './service'
import { AGENTCLI_TOOL_NAME } from './types'
import { Session, User } from 'koishi'

export class AgentCliTool extends StructuredTool {
    name = AGENTCLI_TOOL_NAME

    description =
        'Run ChatLuna agent control commands with the same `agentcli ...` ' +
        'syntax used in the shell. Pass the full command string, keep the ' +
        '`agentcli` prefix, and keep chaining operators like `&&`, `||`, ' +
        '`;`, `|`, and `|&` unchanged.'

    schema = z.object({
        command: z
            .string()
            .describe(
                'The full agentcli command to execute. Keep the `agentcli` prefix and syntax unchanged.'
            )
    })

    constructor(private readonly service: ChatLunaAgentCliService) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _: unknown,
        runConfig?: ChatLunaToolRunnable
    ) {
        const conversationId = runConfig?.configurable?.conversationId
        const session = runConfig?.configurable?.session

        if (
            !conversationId ||
            !session ||
            ((session as Session<User.Field>).user?.authority ?? 0) < 3
        ) {
            return 'Error: agentcli is unavailable in this tool context'
        }

        try {
            return await this.service.executeCommand(
                input.command,
                conversationId,
                session
            )
        } catch (err) {
            return `Error: agentcli failed: ${getErrorMessage(err)}`
        }
    }
}
