/** @module sub-agent/tool */

import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { z } from 'zod'
import { SubAgentTaskService } from '../types'

export class TaskTool extends StructuredTool {
    name = 'task'
    description: string
    schema = z
        .object({
            action: z
                .enum(['run', 'status', 'list', 'list_all', 'message', 'stop'])
                .optional()
                .describe(
                    'run starts or resumes a sub-agent task, status inspects ' +
                        'one task, list shows recent tasks in this conversation, ' +
                        'list_all shows every task, message sends live guidance ' +
                        'to a running background task, stop aborts a running ' +
                        'background task.'
                ),
            agent: z
                .string()
                .optional()
                .describe(
                    'The exact sub-agent name from the injected sub-agent catalog. ' +
                        'Required when starting a new task. Optional when ' +
                        'resuming an existing task by id.'
                ),
            id: z
                .string()
                .optional()
                .describe(
                    'Existing task id returned by an earlier task call. Reuse it to inspect, message, or continue the same sub-agent session.'
                ),
            prompt: z
                .string()
                .optional()
                .describe(
                    'The delegated task or follow-up instruction. Required ' +
                        'when action is run. Use goal for the structured ' +
                        'Markdown objective.'
                ),
            goal: z
                .string()
                .optional()
                .describe(
                    'Markdown goal block for the sub-agent. Include objective, scope, success criteria, expected output, and constraints.'
                ),
            reason: z
                .string()
                .optional()
                .describe('Optional reason for delegating the task'),
            background: z
                .boolean()
                .optional()
                .describe(
                    'Run the sub-agent in the background. Prefer this for long-running work so it can continue beyond the normal tool timeout.'
                ),
            message: z
                .string()
                .optional()
                .describe(
                    'Live guidance to send to a running background sub-agent. Use with action message.'
                )
        })
        .superRefine((input, ctx) => {
            const action = input.action ?? 'run'

            if (action === 'run' && !input.prompt?.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['prompt'],
                    message: 'prompt is required when action is run.'
                })
            }

            if (
                (action === 'status' ||
                    action === 'message' ||
                    action === 'stop') &&
                !input.id?.trim()
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['id'],
                    message:
                        'id is required when action is status, message, or stop.'
                })
            }

            if (action === 'message' && !input.message?.trim()) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['message'],
                    message: 'message is required when action is message.'
                })
            }
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
        return await this.service.runTask(input, runConfig)
    }
}
